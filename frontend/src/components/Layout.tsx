import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import FamilySelector from './FamilySelector';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop expand/collapse
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false); // mobile drawer
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const menuItems = [
    { path: '/', label: '仪表板', icon: '📊' },
    { path: '/families', label: '家庭管理', icon: '👨‍👩‍👧‍👦' },
    { path: '/transactions', label: '交易记录', icon: '💰' },
    { path: '/assets', label: '资产管理', icon: '🏠' },
    { path: '/liabilities', label: '负债管理', icon: '💳' },
    { path: '/reports/balance-sheet', label: '资产负债表', icon: '📈' },
    { path: '/reports/income-statement', label: '利润表', icon: '📋' },
    { path: '/reports/cash-flow', label: '现金流量表', icon: '💵' },
    { path: '/reports/investment', label: '投资配置', icon: '📊' },
    { path: '/reports/ai-analysis', label: 'AI 分析', icon: '📈' },
    { path: '/files', label: '文件管理', icon: '📁' },
    { path: '/budgets', label: '预算管理', icon: '🎯' },
    { path: '/recurring', label: '定期记账', icon: '🔁' },
    { path: '/compare', label: '家庭对比', icon: '⚖️' },
    { path: '/import', label: '数据导入', icon: '📥' },
    { path: '/goals', label: '财务目标', icon: '⭐' },
    { path: '/ai', label: 'AI 助手', icon: '🤖' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex">
        {/* Sidebar - desktop */}
        <aside
          className={`${
            sidebarOpen ? 'w-64' : 'w-20'
          } bg-white shadow-lg transition-all duration-300 min-h-screen hidden md:block`}
        >
          <div className="p-4 border-b border-gray-200">
            <h1 className={`font-bold text-xl text-indigo-600 ${!sidebarOpen && 'hidden'}`}>
              Family Finance
            </h1>
            {!sidebarOpen && <h1 className="font-bold text-xl text-indigo-600 text-center">F</h1>}
          </div>
          <nav className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
            {menuItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                  location.pathname === item.path
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {sidebarOpen && <span className="ml-3">{item.label}</span>}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Sidebar - mobile drawer */}
        {mobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black bg-opacity-50"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative w-64 bg-white shadow-xl min-h-screen overflow-y-auto">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h1 className="font-bold text-xl text-indigo-600">Family Finance</h1>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="text-gray-500 hover:text-gray-900 text-2xl leading-none"
                  aria-label="关闭菜单"
                >
                  ×
                </button>
              </div>
              <nav className="p-4 space-y-2">
                {menuItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                      location.pathname === item.path
                        ? 'bg-indigo-50 text-indigo-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-xl">{item.icon}</span>
                    <span className="ml-3">{item.label}</span>
                  </Link>
                ))}
              </nav>
            </aside>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <header className="bg-white shadow-sm px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-30">
            <div className="flex items-center space-x-2 md:space-x-4">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden text-gray-600 hover:text-gray-900 p-2 -ml-2"
                aria-label="打开菜单"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="hidden md:block text-gray-600 hover:text-gray-900"
                aria-label="切换侧边栏"
              >
                {sidebarOpen ? '◀' : '▶'}
              </button>
              <div className="w-36 md:w-48">
                <FamilySelector />
              </div>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4">
              <span className="text-gray-700 text-sm md:text-base hidden sm:inline">欢迎，{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-red-600 px-3 py-2 border border-gray-300 rounded hover:border-red-300 transition-colors"
              >
                退出
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default Layout;
