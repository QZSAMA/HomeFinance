import { useState, useEffect } from 'react';
import { getFamilies } from '../services/familyService';
import { useFamilyStore } from '../store/useFamilyStore';

const FamilySelector = () => {
  const [loading, setLoading] = useState(true);
  const { currentFamily, setCurrentFamily, families, setFamilies } = useFamilyStore();

  useEffect(() => {
    loadFamilies();
  }, []);

  const loadFamilies = async () => {
    try {
      const data = await getFamilies();
      setFamilies(data);
      if (data.length > 0 && !currentFamily) {
        setCurrentFamily(data[0]);
      }
    } catch (err) {
      console.error('加载家庭列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

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
