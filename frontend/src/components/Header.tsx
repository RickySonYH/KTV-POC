// [advice from AI] KTV 스타일 헤더 컴포넌트 - 탭 네비게이션 지원 (WhisperLiveKit 전용)

interface HeaderProps {
  activeTab?: 'subtitle' | 'whisper' | 'guide';
  onTabChange?: (tab: 'subtitle' | 'whisper' | 'guide') => void;
}

const Header = ({ activeTab = 'subtitle', onTabChange }: HeaderProps) => {
  const handleTabClick = (tab: 'subtitle' | 'whisper' | 'guide', e: React.MouseEvent) => {
    e.preventDefault();
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-top-inner">
          <span>KTV 국민방송 | 실시간 AI 자동자막 시스템</span>
          <span>POC 평가 버전</span>
        </div>
      </div>
      <div className="header-main">
        <a href="/" className="logo" onClick={(e) => handleTabClick('subtitle', e)}>
          <div className="logo-icon">KTV</div>
          <div className="logo-text">
            <span>KTV</span> AI 자막 시스템
          </div>
        </a>
        <nav className="nav-menu">
          <a 
            href="#" 
            className={`nav-item ${activeTab === 'subtitle' ? 'active' : ''}`}
            onClick={(e) => handleTabClick('subtitle', e)}
          >
            자막 생성
          </a>
          <a 
            href="#" 
            className={`nav-item ${activeTab === 'whisper' ? 'active' : ''}`}
            onClick={(e) => handleTabClick('whisper', e)}
          >
            관리페이지
          </a>
          <a 
            href="#" 
            className={`nav-item ${activeTab === 'guide' ? 'active' : ''}`}
            onClick={(e) => handleTabClick('guide', e)}
          >
            사용 가이드
          </a>
        </nav>
      </div>
    </header>
  );
};

export default Header;
