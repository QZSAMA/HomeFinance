import { useState, useEffect, useCallback, useRef } from 'react';
import { getFamilies } from '../services/familyService';
import {
  getPersistedCurrentFamilyId,
  useFamilyStore,
} from '../store/useFamilyStore';

const FamilySelector = () => {
  const [loading, setLoading] = useState(true);
  const { currentFamily, setCurrentFamily, families, setFamilies } = useFamilyStore();
  const mountedRef = useRef(true);

  const loadFamilies = useCallback(async () => {
    try {
      const data = await getFamilies();
      if (!mountedRef.current) return;
      setFamilies(data);
      const live = useFamilyStore.getState().currentFamily;
      const persistedId = getPersistedCurrentFamilyId();
      const preferred = data.find((item) => item.id === persistedId)
        ?? (live ? data.find((item) => item.id === live.id) : undefined);

      if (preferred) {
        if (live?.id !== preferred.id || live !== preferred) setCurrentFamily(preferred);
      } else if (data.length > 0) {
        setCurrentFamily(data[0]);
      } else {
        setCurrentFamily(null);
      }
    } catch (err) {
      console.error('加载家庭列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [setCurrentFamily, setFamilies]);

  useEffect(() => {
    mountedRef.current = true;
    void loadFamilies();
    return () => {
      mountedRef.current = false;
    };
  }, [loadFamilies]);

  if (loading) {
    return <div className="text-sm text-gray-500">加载中...</div>;
  }

  if (families.length === 0) {
    return <div className="text-sm text-gray-500">暂无家庭，请先创建</div>;
  }

  return (
    <div className="relative">
      <select
        value={currentFamily?.id || ''}
        onChange={(e) => {
          const family = families.find((f) => f.id === e.target.value);
          if (family) setCurrentFamily(family);
        }}
        className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
      >
        {families.map((family) => (
          <option key={family.id} value={family.id}>
            {family.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default FamilySelector;
