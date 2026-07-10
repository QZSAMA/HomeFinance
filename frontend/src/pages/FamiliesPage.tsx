import { useState, useEffect } from 'react';
import { getFamilies, createFamily, inviteMember, removeMember } from '../services/familyService';
import type { Family } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { useFamilyStore } from '../store/useFamilyStore';

const FamiliesPage = () => {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [newFamilyDesc, setNewFamilyDesc] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<Family | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [error, setError] = useState('');
  const { user } = useAuthStore();
  const { setFamilies: setStoreFamilies, setCurrentFamily } = useFamilyStore();

  useEffect(() => {
    loadFamilies();
  }, []);

  const loadFamilies = async () => {
    try {
      const data = await getFamilies();
      setFamilies(data);
      setStoreFamilies(data);
    } catch (err) {
      console.error('加载家庭列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const newFamily = await createFamily(newFamilyName, newFamilyDesc);
      const updatedFamilies = [...families, newFamily];
      setFamilies(updatedFamilies);
      setStoreFamilies(updatedFamilies);
      setCurrentFamily(newFamily);
      setShowCreateModal(false);
      setNewFamilyName('');
      setNewFamilyDesc('');
    } catch (err: any) {
      setError(err.response?.data?.error || '创建失败');
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedFamily) return;
    try {
      const updated = await inviteMember(selectedFamily.id, inviteEmail, inviteRole);
      setFamilies(families.map(f => f.id === updated.id ? updated : f));
      setSelectedFamily(updated);
      setShowInviteModal(false);
      setInviteEmail('');
    } catch (err: any) {
      setError(err.response?.data?.error || '邀请失败');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedFamily) return;
    if (!confirm('确定要移除该成员吗？')) return;
    try {
      await removeMember(selectedFamily.id, memberId);
      loadFamilies();
      if (selectedFamily) {
        const updatedFamilies = await getFamilies();
        const updated = updatedFamilies.find(f => f.id === selectedFamily.id);
        if (updated) setSelectedFamily(updated);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || '移除失败');
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: '管理员',
      member: '成员',
      viewer: '只读'
    };
    return labels[role] || role;
  };

  const isCurrentUserAdmin = (family: Family) => {
    return family.members.some(m => m.userId === user?.id && m.role === 'admin');
  };

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">家庭管理</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 创建家庭
        </button>
      </div>

      {families.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 text-lg">你还没有加入任何家庭</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 text-indigo-600 hover:text-indigo-700"
          >
            创建第一个家庭
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {families.map((family) => (
            <div
              key={family.id}
              className="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setSelectedFamily(family)}
            >
              <h3 className="text-lg font-semibold text-gray-900">{family.name}</h3>
              {family.description && (
                <p className="text-gray-500 text-sm mt-1">{family.description}</p>
              )}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  {family.members.length} 位成员
                </span>
                <span className="text-xs text-gray-400">
                  {isCurrentUserAdmin(family) ? '管理员' : '成员'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建家庭弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">创建家庭</h2>
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleCreateFamily} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  家庭名称
                </label>
                <input
                  type="text"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例如：我们的小家"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  描述（可选）
                </label>
                <textarea
                  value={newFamilyDesc}
                  onChange={(e) => setNewFamilyDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={3}
                  placeholder="简单描述一下这个家庭"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setError('');
                  }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 家庭详情弹窗 */}
      {selectedFamily && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{selectedFamily.name}</h2>
                {selectedFamily.description && (
                  <p className="text-gray-500 text-sm mt-1">{selectedFamily.description}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedFamily(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">成员列表</h3>
              {isCurrentUserAdmin(selectedFamily) && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="text-sm text-indigo-600 hover:text-indigo-700"
                >
                  + 邀请成员
                </button>
              )}
            </div>

            <div className="space-y-2">
              {selectedFamily.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-semibold">
                      {member.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{member.user.name}</p>
                      <p className="text-sm text-gray-500">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500">{getRoleLabel(member.role)}</span>
                    {isCurrentUserAdmin(selectedFamily) && member.userId !== user?.id && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 邀请成员弹窗 */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">邀请成员</h2>
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="成员的邮箱地址"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">该用户需先注册账号</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  角色
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="admin">管理员</option>
                  <option value="member">成员（可编辑）</option>
                  <option value="viewer">只读</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setError('');
                  }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  邀请
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FamiliesPage;
