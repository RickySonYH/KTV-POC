import asyncio
import websockets
import json
import os
import shutil
import time
from datetime import datetime
import argparse

log_queue = asyncio.Queue()
failed_count = 0
zerotxt_count = 0
successful_files = 0
xrt_values = []

class MyClient:
    def __init__(self, filename, uri, byterate=32000, norealtime=False):
        self.filename = filename
        self.uri = uri
        self.byterate = byterate
        self.session_id = None
        self.first_receive = 0
        self.first_time = 0.0
        self.final_send_time = 0.0
        self.final_receive_time = 0.0
        self.total_length = 0.0
        self.norealtime = norealtime
        self.transcript_received = False
        self.failed = False

    async def send_data(self, websocket):
        try:
            with open(self.filename, "rb") as src_file:
                for block in iter(lambda: src_file.read(int(self.byterate / 4)), b''):
                    try:
                        self.final_send_time = time.time()
                        await websocket.send(block)
                        if not self.norealtime:
                            await asyncio.sleep(0.25)
                            # await asyncio.sleep(0.01)
                        #else:
                        #    await asyncio.sleep(0.01)
                            
                    except Exception as e:
                        print(f"Error sending data for {self.filename}: {e}")
                        await self.copy_to_failed()
                        return
        except FileNotFoundError:
            print(f"File not found: {self.filename}")
            return
        # if self.norealtime:
        await websocket.send("EOS")
        print("EOS SEND")

    async def receive_data(self, websocket):
        try:
            async for message in websocket:
                if isinstance(message, str) and message.startswith("Progress:"):
                    progress_value = message.split(":", 1)[1].strip()
                    print(f"Progress update for {self.filename}: {progress_value}%")
                    
                    # Progress:100.0이면 배치 처리 완료 신호
                    if progress_value == "100.0":
                        print(f"Batch processing completed for {self.filename} (Progress:100.0)")
                    continue
                
                # 기존 JSON 메시지 처리
                try:
                    response = json.loads(message)
                except json.JSONDecodeError as e:
                    print(f"JSON parsing error for {self.filename}: {e}, message: {message[:100]}...")
                    continue

                print(f"Received message for {self.filename}: {response}")

                if self.first_receive == 0:
                    self.session_id = response.get('sessionId', 'unknown')
                    self.first_time = time.time()
                    self.first_receive += 1

                if 'status' in response:
                    self.final_receive_time = time.time()
                    if response['result']['final']:
                        transcript = response['result']['hypotheses'][0]['transcript']
                        spk = response['speaker']
                        seg_start = response['segment-start']
                        seg_end = round(seg_start + response['segment-length'], 2)
                        if transcript.strip():
                            self.transcript_received = True
                        print(f"Transcript saved for {self.filename}: {transcript}")
                        with open(os.path.splitext(self.filename)[0] + '.txt', 'a', encoding='utf-8') as w:
                            w.write(transcript + '\n')
                            # w.write('start: ' + str(seg_start) + ', ' + 'end: ' + str(seg_end) + ', spk ' + str(spk) + ' : ' + transcript + '\n')

                    if response.get('total-length'):
                        self.total_length = float(response['total-length'])

                if isinstance(response, dict) and response.get("status") == 0 and response.get("EOS", False):
                    print(f"EOS received for {self.filename}, closing connection.")
                    break

        except websockets.ConnectionClosed as e:
            print(f"Connection closed unexpectedly for {self.filename}: {e}")
            await self.copy_to_failed()
        except AttributeError as e:
            print(f"AttributeError in receive_data for {self.filename}: {e}")
            # await self.copy_to_failed()
        except Exception as e:
            print(response)
            print(f"Unexpected error in receive_data for {self.filename}: {e}")
            await self.copy_to_failed()

    async def run(self):
        try:
            async with websockets.connect(self.uri) as websocket:
                print(f"WebSocket connection opened for {self.filename}")
                send_task = asyncio.create_task(self.send_data(websocket))
                receive_task = asyncio.create_task(self.receive_data(websocket))
                current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
                print(f"##### start time : {current_time} #####")
                await asyncio.gather(send_task, receive_task, return_exceptions=True)
        except websockets.ConnectionClosed as e:
            print(f"WebSocket connection closed unexpectedly for {self.filename}: {e}")
            await self.copy_to_failed()
        except Exception as e:
            print(f"Unexpected error for {self.filename}: {e}")
            await self.copy_to_failed()
        finally:
            if not self.failed:
                if not self.transcript_received:
                    await self.copy_to_zerotxt()
                else:
                    await self.log_results()

    async def log_results(self):
        global successful_files, xrt_values

        if self.total_length == 0:
            xrt = 0.0
        else:
            xrt = round((self.final_receive_time - self.first_time) / self.total_length, 4)

        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        log_entry = f"{self.filename} finished. xRT = {xrt}, {current_time}\n"
        
        await log_queue.put(log_entry)
        successful_files += 1
        xrt_values.append(xrt)

    async def copy_to_failed(self):
        global failed_count
        if not self.failed:
            failed_dir = "./failed/"
            if not os.path.exists(failed_dir):
                os.makedirs(failed_dir)
            shutil.copy2(self.filename, os.path.join(failed_dir, os.path.basename(self.filename)))
            failed_count += 1
            self.failed = True
            print(f"Copied {self.filename} to {failed_dir}")

    async def copy_to_zerotxt(self):
        global zerotxt_count
        zerotxt_dir = "./zerotxt/"
        if not os.path.exists(zerotxt_dir):
            os.makedirs(zerotxt_dir)
        shutil.copy2(self.filename, os.path.join(zerotxt_dir, os.path.basename(self.filename)))
        zerotxt_count += 1
        print(f"Copied {self.filename} to {zerotxt_dir}")

async def process_file(filename, uri, semaphore, byterate, norealtime):
    async with semaphore:
        client = MyClient(filename, uri, byterate, norealtime)
        await client.run()

async def process_directory(directory, uri, semaphore_limit, byterate, norealtime):
    semaphore = asyncio.Semaphore(semaphore_limit)
    tasks = []
    clear_txt_files(directory)

    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".WAV") or file.endswith(".wav") or file.endswith(".flac"):
                filepath = os.path.join(root, file)
                tasks.append(process_file(filepath, uri, semaphore, byterate, norealtime))

    await asyncio.gather(*tasks, return_exceptions=True)
    await write_log_and_summary()

def clear_txt_files(directory):
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".txt"):
                file_path = os.path.join(root, file)
                try:
                    os.remove(file_path)
                    print(f"Deleted {file_path}")
                except Exception as e:
                    print(f"Failed to delete {file_path}: {e}")

async def write_log_and_summary():
    log_file = f"final_print_str_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    log_dir = "./logs/"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    with open(log_dir + log_file, 'w') as f:
        while not log_queue.empty():
            log_entry = await log_queue.get()
            f.write(log_entry)
            print(log_entry.strip())

        if successful_files > 0:
            avg_xrt = sum(xrt_values) / successful_files
        else:
            avg_xrt = 0.0

        summary = f"\nSummary: Total files = {successful_files + failed_count}, " \
                  f"Successful = {successful_files}, " \
                  f"Average xRT = {avg_xrt:.4f}, " \
                  f"Failed = {failed_count}, Zero Text = {zerotxt_count}\n"

        f.write(summary)
        print(summary.strip())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-u', '--uri', required=True, help="WebSocket URI. <ip>:<port>")
    parser.add_argument('-d', '--directory', required=True, help="Directory containing .wav files")
    # 채널 수.
    parser.add_argument('-ch', '--semaphore', type=int, default=1, help="Maximum number of simultaneous connections")
    parser.add_argument('--byterate', type=int, default=16000, help="Bytes sent per second")
    parser.add_argument('--model-name', default="KOREAN_ONLINE_8K", help="Model name for the WebSocket connection")
    parser.add_argument('-pid', '--project_id', default=None, help="Project ID for the WebSocket connection (optional)")
    # norealtime은 온라인 디코더에 파일을 밀어넣는 경우만 사용할 것. 배치 디코더에서는 xRT가 정상 동작하지 않음. 
    # norealtime의 기본값은 False로, 기본은 실시간임. 
    parser.add_argument('--norealtime', action='store_true', default=False, help="File BATCH, sleep 0.25 don't use.")
    parser.add_argument('-spk', '--num_speaker', default=None, help="화자 분리할 사람 수 (optional)")
    parser.add_argument('--loop', action='store_true', default=False, help="STT 반복 수행.")
    parser.add_argument('--verbosity', default="final", help="STT 결과 출력 레벨.")
    parser.add_argument('--language', default="ko", help="언어 설정.")

    args = parser.parse_args()

    model_name = args.model_name
    print(f'model name : {model_name}, byterate : {args.byterate}, project id : {args.project_id}, test channel : {args.semaphore}')
    uri = f"ws://{args.uri}/client/ws/speech"
    uri += f"?model={model_name}"
    if args.project_id:
        uri += f"&project={args.project_id}"
    if args.num_speaker:
        uri += f"&num-speaker={args.num_speaker}"
    # 배치 디코더에서는 사용 불가. 
    if args.norealtime:
        uri += "&mode=batch"
    if args.verbosity:
        uri += f"&verbosity={args.verbosity}"
    if args.language:
        uri += f"&lang={args.language}"

    # uri += f"&single=false&content-type=audio/x-raw,+layout=(string)interleaved,+rate=(int)8000,+format=(string)S16LE,+channels=(int)1"

    if args.loop:
        loop_count = 1
        while True:
            asyncio.run(process_directory(args.directory, uri, args.semaphore, args.byterate, args.norealtime))
            print(f"{loop_count} 번째 시행이 끝났습니다. 20초 후 다시 시작합니다.")
            time.sleep(20)
            loop_count += 1
    else:
        print(f"uri : {uri}")
        asyncio.run(process_directory(args.directory, uri, args.semaphore, args.byterate, args.norealtime))

if __name__ == "__main__":
    import sys

    sys.argv = [
        "HAIV_client_20250314.py", 
        # "-u", "43.200.137.38:40000", 
        # "-u", "dev-ecp-haiv.langsa.ai", 
        "-u", "haiv.timbel.net:40001", 
        "-ch", "1", # 사용할 채널 개수
        "--byterate", "16000", 
        # "--model-name", "KOREAN_ONLINE_8K", 
        "--model-name", "KOREAN_ONLINE_8K", 
        "-d", './김경진', # STT 진행할 음성 파일이 들어있는 폴더
        # "--project_id", "9dc145a8-26fc-4305-a447-4cf6af808f30"
        # "--language", "ja",
    ]
    
    main()


    # run sample
    # python3 HAIV_client_20250204.py -u 127.0.0.1:53179 -d ./test_8k_1 -ch 1 --byterate 16000 --model-name KOREAN_ONLINE_8K -pid 0a7dbc0b-8e95-4e13-8fa7-5f205c1c74e4 -spk 2 --norealtime
