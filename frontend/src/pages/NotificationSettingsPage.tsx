import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getPreferences,
  updatePreferences,
  type NotificationPreference,
  type NotificationSeverity,
} from '../services/notificationService';
import {
  isPushSupported,
  subscribeUser,
  unsubscribeUser,
  getSubscriptionStatus,
} from '../services/pushService';
import { TYPE_LABELS } from '../services/alertService';

// 7 种告警类型（与后端 ALERT_TYPES 对齐）
const PREF_ALERT_TYPES = [
  'LARGE_EXPENSE',
  'FREQUENCY_SPIKE',
  'CATEGORY_SURGE',
  'DUPLICATE',
  'BUDGET_EXCEEDED',
  'BUDGET_WARNING',
  'SYSTEM',
] as const;

// 偏好页类型标签：复用告警类型标签映射并补充 SYSTEM
const PREF_TYPE_LABELS: Record<string, string> = {
  ...TYPE_LABELS,
  SYSTEM: '系统通知',
};

// severity 下拉选项：低 / 中 / 高
const SEVERITY_OPTIONS: { value: NotificationSeverity; label: string }[] = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
];

// 简易开关（button 实现，样式与项目按钮风格一致）
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

const NotificationSettingsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  // 推送渠道状态
  const [pushSupported] = useState(() => isPushSupported());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  // 初始化推送订阅状态
  useEffect(() => {
    if (!pushSupported) return;
    getSubscriptionStatus()
      .then(setPushEnabled)
      .catch(() => setPushEnabled(false));
  }, [pushSupported]);

  const loadPreferences = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const prefs = await getPreferences(currentFamily.id);
      // 按已知类型排序展示，缺失类型按默认值补全（后端惰性创建，正常返回全部 7 类）
      setPreferences(
        PREF_ALERT_TYPES.map((alertType) => {
          const found = prefs.find((p) => p.alertType === alertType);
          return (
            found ?? {
              id: '',
              alertType,
              minSeverity: 'LOW' as NotificationSeverity,
              inAppEnabled: true,
              emailEnabled: false,
              pushEnabled: false,
            }
          );
        })
      );
    } catch (err: any) {
      setError(err.response?.data?.error || '加载通知偏好失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentFamily) loadPreferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFamily]);

  // 局部更新某类型偏好
  const updatePreference = (alertType: string, patch: Partial<NotificationPreference>) => {
    setPreferences((prev) =>
      prev.map((p) => (p.alertType === alertType ? { ...p, ...patch } : p))
    );
  };

  // 保存全部偏好
  const handleSave = async () => {
    if (!currentFamily || saving) return;
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      const updated = await updatePreferences(
        currentFamily.id,
        preferences.map(({ alertType, minSeverity, inAppEnabled, emailEnabled, pushEnabled }) => ({
          alertType,
          minSeverity,
          inAppEnabled,
          emailEnabled,
          pushEnabled,
        }))
      );
      setPreferences(updated);
      setSaveMessage('保存成功');
    } catch (err: any) {
      setSaveError(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 开启浏览器推送
  const handleSubscribe = async () => {
    if (pushLoading) return;
    setPushLoading(true);
    setPushMessage('');
    try {
      await subscribeUser();
      setPushEnabled(true);
      setPushMessage('推送已开启');
    } catch (err: any) {
      setPushMessage(err.response?.data?.error || err.message || '开启推送失败');
    } finally {
      setPushLoading(false);
    }
  };

  // 关闭浏览器推送
  const handleUnsubscribe = async () => {
    if (pushLoading) return;
    setPushLoading(true);
    setPushMessage('');
    try {
      await unsubscribeUser();
      setPushEnabled(false);
      setPushMessage('推送已关闭');
    } catch (err: any) {
      setPushMessage(err.response?.data?.error || err.message || '关闭推送失败');
    } finally {
      setPushLoading(false);
    }
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">通知设置</h1>
        <p className="text-sm text-gray-500 mt-1">
          配置各通知渠道的开关与最低提醒严重度。
        </p>
      </div>

      {/* 渠道状态 */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-medium text-gray-900">📧 邮件通知（需管理员配置 SMTP）</h2>
          <p className="text-sm text-gray-500 mt-1">
            服务端未配置 SMTP 时邮件渠道将自动跳过，不影响站内与推送渠道。
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-medium text-gray-900">📣 浏览器推送</h2>
          {!pushSupported ? (
            <p className="text-sm text-gray-500 mt-1">当前浏览器不支持推送</p>
          ) : (
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <span className={`text-sm ${pushEnabled ? 'text-green-700' : 'text-gray-500'}`}>
                {pushEnabled ? '已开启' : '未开启'}
              </span>
              {pushEnabled ? (
                <button
                  onClick={handleUnsubscribe}
                  disabled={pushLoading}
                  className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {pushLoading ? '处理中...' : '关闭推送'}
                </button>
              ) : (
                <button
                  onClick={handleSubscribe}
                  disabled={pushLoading}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {pushLoading ? '处理中...' : '开启浏览器推送'}
                </button>
              )}
            </div>
          )}
          {pushMessage && <p className="text-sm text-gray-500 mt-2">{pushMessage}</p>}
        </div>
      </div>

      {error && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}

      {/* 偏好表格 */}
      {loading ? (
        <div className="bg-white rounded-lg shadow text-center py-12 text-gray-500">
          加载中...
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-4 py-3 font-medium text-left">告警类型</th>
                <th className="px-4 py-3 font-medium text-left">最低严重度</th>
                <th className="px-4 py-3 font-medium text-center">站内</th>
                <th className="px-4 py-3 font-medium text-center">邮件</th>
                <th className="px-4 py-3 font-medium text-center">推送</th>
              </tr>
            </thead>
            <tbody>
              {preferences.map((pref) => (
                <tr key={pref.alertType} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-4 py-3 text-gray-900">
                    {PREF_TYPE_LABELS[pref.alertType] ?? pref.alertType}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={pref.minSeverity}
                      onChange={(e) =>
                        updatePreference(pref.alertType, {
                          minSeverity: e.target.value as NotificationSeverity,
                        })
                      }
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                    >
                      {SEVERITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      checked={pref.inAppEnabled}
                      onChange={(v) => updatePreference(pref.alertType, { inAppEnabled: v })}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      checked={pref.emailEnabled}
                      onChange={(v) => updatePreference(pref.alertType, { emailEnabled: v })}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      checked={pref.pushEnabled}
                      onChange={(v) => updatePreference(pref.alertType, { pushEnabled: v })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 保存 */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {saveMessage && <span className="text-sm text-green-700">{saveMessage}</span>}
        {saveError && <span className="text-sm text-red-600">{saveError}</span>}
      </div>
    </div>
  );
};

export default NotificationSettingsPage;
