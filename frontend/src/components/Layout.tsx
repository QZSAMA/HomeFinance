import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import FamilySelector from './FamilySelector';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'w-64' : 'w-20'
          } bg-white shadow-lg transition-all duration-300 min-h-screen`}
        >
          <div className="p-4 border-b border-gray-200">
            <h1 className={`font-bold text-xl text-indigo-600 ${!sidebarOpen && 'hidden'}`}>
              Family Finance
            </h1>
            {!sidebarOpen && <h1 className="font-bold text-xl text-indigo-600 text-center">F</h1>}
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
                {sidebarOpen && <span className="ml-3">{item.label}</span>}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1">
          {/* Header */}
          <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="text-gray-600 hover:text-gray-900"
              >
                {sidebarOpen ? '◀' : '▶'}
              </button>
              <div className="w-48">
                <FamilySelector />
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">欢迎，{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-red-600 px-3 py-1 border border-gray-300 rounded hover:border-red-300 transition-colors"
              >
                退出
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="p-6">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default Layout;
