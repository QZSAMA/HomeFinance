import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

// 路由级懒加载：每个页面独立 chunk，减少首屏体积
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const FamiliesPage = lazy(() => import('./pages/FamiliesPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const AssetsPage = lazy(() => import('./pages/AssetsPage'));
const LiabilitiesPage = lazy(() => import('./pages/LiabilitiesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const AIPage = lazy(() => import('./pages/AIPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const BudgetPage = lazy(() => import('./pages/BudgetPage'));
const RecurringPage = lazy(() => import('./pages/RecurringPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const ImportSourcesPage = lazy(() => import('./pages/ImportSourcesPage'));
const ExchangeRatePage = lazy(() => import('./pages/ExchangeRatePage'));
const GoalsPage = lazy(() => import('./pages/GoalsPage'));
// V3.3.4：净值趋势与投资收益页面，独立 chunk
const NetWorthPage = lazy(() => import('./pages/NetWorthPage'));
const InvestmentIncomePage = lazy(() => import('./pages/InvestmentIncomePage'));

function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <DashboardPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/families"
            element={
              <ProtectedRoute>
                <Layout>
                  <FamiliesPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <Layout>
                  <TransactionsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets"
            element={
              <ProtectedRoute>
                <Layout>
                  <AssetsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/liabilities"
            element={
              <ProtectedRoute>
                <Layout>
                  <LiabilitiesPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/net-worth"
            element={
              <ProtectedRoute>
                <Layout>
                  <NetWorthPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/investment-income"
            element={
              <ProtectedRoute>
                <Layout>
                  <InvestmentIncomePage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReportsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          {/* 旧路由重定向（向下兼容书签） */}
          <Route path="/reports/balance-sheet" element={<Navigate to="/reports" replace />} />
          <Route path="/reports/income-statement" element={<Navigate to="/reports" replace />} />
          <Route path="/reports/cash-flow" element={<Navigate to="/reports" replace />} />
          <Route path="/reports/investment" element={<Navigate to="/reports" replace />} />
          <Route path="/reports/ai-analysis" element={<Navigate to="/ai" replace />} />
          <Route
            path="/ai"
            element={
              <ProtectedRoute>
                <Layout>
                  <AIPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/files"
            element={
              <ProtectedRoute>
                <Layout>
                  <FilesPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/budgets"
            element={
              <ProtectedRoute>
                <Layout>
                  <BudgetPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/recurring"
            element={
              <ProtectedRoute>
                <Layout>
                  <RecurringPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/compare"
            element={
              <ProtectedRoute>
                <Layout>
                  <ComparePage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/import"
            element={
              <ProtectedRoute>
                <Layout>
                  <ImportPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/import-sources"
            element={
              <ProtectedRoute>
                <Layout>
                  <ImportSourcesPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/exchange-rates"
            element={
              <ProtectedRoute>
                <Layout>
                  <ExchangeRatePage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/goals"
            element={
              <ProtectedRoute>
                <Layout>
                  <GoalsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <Layout>
                  <div className="text-center py-12">
                    <h2 className="text-2xl font-bold text-gray-900">页面开发中</h2>
                    <p className="text-gray-500 mt-2">该功能正在建设中，敬请期待</p>
                  </div>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
