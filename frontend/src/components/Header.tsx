// [advice from AI] KTV 스타일 헤더 컴포넌트 - 메인 페이지용 (관리페이지 탭 제거됨)

const Header = () => {
  return (
    <header className="header">
      <div className="header-top">
        <div className="header-top-inner">
          <span>KTV 국민방송 | 실시간 AI 자동자막 시스템</span>
          <span>POC 평가 버전</span>
        </div>
      </div>
      <div className="header-main">
        <a href="/" className="logo">
          <div className="logo-icon">KTV</div>
          <div className="logo-text">
            <span>KTV</span> AI 자막 시스템
          </div>
        </a>
      </div>
    </header>
  );
};

export default Header;
