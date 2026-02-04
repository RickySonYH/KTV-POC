// [advice from AI] 관리페이지 - /timbeladmin 경로용 별도 페이지
import AdminPanel from '../components/AdminPanel';

const AdminPage = () => {
  return (
    <div className="app">
      {/* [advice from AI] 관리페이지 전용 헤더 */}
      <header className="header">
        <div className="header-top">
          <div className="header-top-inner">
            <span>KTV 국민방송 | 실시간 AI 자동자막 시스템</span>
            <span>관리자 페이지</span>
          </div>
        </div>
        <div className="header-main">
          <a href="/" className="logo">
            <div className="logo-icon">KTV</div>
            <div className="logo-text">
              <span>KTV</span> AI 자막 시스템
            </div>
          </a>
          <nav className="nav-menu">
            <a href="/" className="nav-item">
              자막 생성
            </a>
            <span className="nav-item active" style={{ cursor: 'default' }}>
              관리페이지
            </span>
          </nav>
        </div>
      </header>
      
      <main className="main-content">
        <div style={{ width: '100%', height: 'calc(100vh - 100px)', overflowY: 'auto' }}>
          <AdminPanel />
        </div>
      </main>
    </div>
  );
};

export default AdminPage;
