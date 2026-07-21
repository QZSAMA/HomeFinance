import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getFiles,
  uploadFiles,
  deleteFile,
  checkDuplicates,
  type FileRecord,
  type DuplicateResult,
} from '../services/fileService';

export default function FilesPage() {
  const { currentFamily } = useFamilyStore();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateResult['duplicates']>([]);
  const [error, setError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentFamily) {
      loadData();
    }
  }, [currentFamily]);

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const [fileList, dupResult] = await Promise.all([
        getFiles(currentFamily.id),
        checkDuplicates(currentFamily.id),
      ]);
      setFiles(fileList);
      setDuplicates(dupResult.duplicates);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !currentFamily) return;

    setUploading(true);
    setUploadMessage('');
    setError('');
    try {
      const result = await uploadFiles(currentFamily.id, Array.from(selectedFiles));
      setUploadMessage(result.message);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定删除此文件？')) return;
    try {
      await deleteFile(currentFamily.id, id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');

  if (!currentFamily) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">请先选择一个家庭</h2>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">文件管理</h2>
        <div className="flex items-center space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {uploading ? '上传中...' : '上传文件'}
          </button>
        </div>
      </div>

      {uploadMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">
          {uploadMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          <p className="font-medium mb-1">检测到 {duplicates.length} 组可能重复的图片：</p>
          {duplicates.map((d, i) => (
            <p key={i} className="text-xs">
              "{d.file1}" 与 "{d.file2}" 相似度 {d.similarity}%
            </p>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : files.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">暂无文件</p>
          <p className="mt-2 text-sm">点击右上角"上传文件"按钮上传</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((file) => (
            <div
              key={file.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            >
              <div className="h-40 bg-gray-100 flex items-center justify-center">
                {isImage(file.mimeType) && file.url ? (
                  <img src={file.url} alt={file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-4xl text-gray-300">
                    {file.mimeType.includes('pdf') ? '📄' :
                     file.mimeType.includes('sheet') ? '📊' :
                     file.mimeType.includes('word') ? '📝' : '📎'}
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-900 truncate" title={file.name}>
                  {file.name}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-500">
                    {formatFileSize(file.size)} · {new Date(file.uploadedAt).toLocaleDateString('zh-CN')}
                  </span>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
                {file.url && (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:text-indigo-700 mt-1 inline-block"
                  >
                    查看 →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
