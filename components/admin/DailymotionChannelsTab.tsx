"use client";

import { useState } from "react";
import { Plus, Edit2, Trash2, Star, Download, X, Lock } from "lucide-react";
import type { DailymotionChannelConfig } from "@/types/dailymotion-config";
import type { DailymotionChannelsTabProps } from "./types";
import { isSubscriptionUrl } from "@/lib/utils";

export function DailymotionChannelsTab({
  channels,
  defaultChannelId,
  onChannelsChange,
  onShowToast,
  onShowConfirm,
  unifiedImport,
}: DailymotionChannelsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    username: "",
    displayName: "",
    avatarUrl: "",
  });
  const [importing, setImporting] = useState(false);

  // 加密导入相关状态
  const [showEncryptedImportModal, setShowEncryptedImportModal] =
    useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importData, setImportData] = useState("");
  const [importPreview, setImportPreview] = useState<
    Omit<DailymotionChannelConfig, "id" | "createdAt">[] | null
  >(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState("");

  // 重置加密导入弹窗状态
  const resetEncryptedImportModal = () => {
    setShowEncryptedImportModal(false);
    setImportPassword("");
    setImportData("");
    setImportPreview(null);
    setIsDecrypting(false);
    setDecryptError("");
  };

  // 解密预览 - 使用服务器端 API（支持 HTTP 环境）
  const handleDecryptPreview = async () => {
    if (!importPassword || !importData) {
      setDecryptError("请输入密码和加密数据");
      return;
    }

    setIsDecrypting(true);
    setDecryptError("");
    setImportPreview(null);

    try {
      // 使用服务器端 API 进行解密（不依赖 Web Crypto API）
      const response = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSubscriptionUrl(importData)
            ? { password: importPassword, subscriptionUrl: importData }
            : { password: importPassword, encryptedData: importData }
        ),
      });

      const result = await response.json();

      if (result.code !== 200) {
        throw new Error(result.message || "解密失败");
      }

      const payload = result.data;

      if (
        payload.dailymotionChannels &&
        payload.dailymotionChannels.length > 0
      ) {
        setImportPreview(payload.dailymotionChannels);
      } else {
        setDecryptError("配置中没有 Dailymotion 频道数据");
      }
    } catch (error) {
      setDecryptError(error instanceof Error ? error.message : "解密失败");
    } finally {
      setIsDecrypting(false);
    }
  };

  // 确认导入加密配置
  const handleConfirmEncryptedImport = async () => {
    if (!importPreview || importPreview.length === 0) {
      return;
    }

    try {
      // 先从服务器获取最新的数据库数据，避免使用可能包含未保存默认配置的客户端状态
      const freshResponse = await fetch("/api/dailymotion-config");
      const freshResult = await freshResponse.json();

      // 获取数据库中实际存在的用户名列表
      // 注意：如果数据库为空，服务器会返回一个虚拟的 default 频道，需要完全排除这种情况
      const serverChannels =
        freshResult.code === 200 && freshResult.data?.channels
          ? freshResult.data.channels
          : [];

      // 检查是否是虚拟默认配置（数据库实际为空）
      const isVirtualDefaultOnly =
        serverChannels.length === 1 && serverChannels[0].id === "default";

      const existingUsernames = new Set<string>(
        isVirtualDefaultOnly
          ? [] // 数据库为空，没有真实的已存在用户名
          : serverChannels.map((c: { username: string }) => c.username)
      );

      let addedCount = 0;

      // 依次添加频道
      for (const preset of importPreview) {
        // 检查是否已存在于数据库或本次导入中已添加
        if (existingUsernames.has(preset.username)) continue;

        const response = await fetch("/api/dailymotion-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            ...preset,
          }),
        });

        const result = await response.json();
        if (result.code === 200) {
          onChannelsChange(result.data.channels, result.data.defaultChannelId);
          // 记录已添加的用户名，避免重复
          existingUsernames.add(preset.username);
          addedCount++;
        }
      }

      onShowToast({
        message: `已成功导入 ${addedCount} 个频道配置`,
        type: "success",
      });
      resetEncryptedImportModal();
    } catch (error) {
      onShowToast({
        message: error instanceof Error ? error.message : "导入失败",
        type: "error",
      });
    }
  };

  // 清空全部频道
  const handleDeleteAll = () => {
    if (channels.length === 0) {
      onShowToast({ message: "暂无频道可清空", type: "error" });
      return;
    }

    onShowConfirm({
      title: "清空全部频道",
      message: `确定要清空全部 ${channels.length} 个 Dailymotion 频道吗？此操作不可恢复！`,
      danger: true,
      onConfirm: async () => {
        try {
          // 逐个删除所有频道
          for (const channel of channels) {
            await fetch("/api/dailymotion-config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "delete",
                id: channel.id,
              }),
            });
          }
          onChannelsChange([], undefined);
          onShowToast({ message: "已清空全部频道", type: "success" });
        } catch (error) {
          onShowToast({ message: "清空失败", type: "error" });
        }
      },
    });
  };

  const resetForm = () => {
    setFormData({ username: "", displayName: "", avatarUrl: "" });

    setShowModal(false);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!formData.username.trim() || !formData.displayName.trim()) {
      onShowToast({ message: "请填写必填字段", type: "error" });
      return;
    }

    try {
      const response = await fetch("/api/dailymotion-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          ...formData,
        }),
      });

      const result = await response.json();
      if (result.code === 200) {
        onChannelsChange(result.data.channels, result.data.defaultChannelId);
        onShowToast({ message: "频道添加成功", type: "success" });
        resetForm();
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      onShowToast({
        message: error instanceof Error ? error.message : "添加失败",
        type: "error",
      });
    }
  };

  const handleUpdate = async () => {
    if (!formData.username.trim() || !formData.displayName.trim()) {
      onShowToast({ message: "请填写必填字段", type: "error" });
      return;
    }

    try {
      const response = await fetch("/api/dailymotion-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: editingId,
          ...formData,
        }),
      });

      const result = await response.json();
      if (result.code === 200) {
        onChannelsChange(result.data.channels, result.data.defaultChannelId);
        onShowToast({ message: "频道更新成功", type: "success" });
        resetForm();
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      onShowToast({
        message: error instanceof Error ? error.message : "更新失败",
        type: "error",
      });
    }
  };

  const handleDelete = (channel: DailymotionChannelConfig) => {
    onShowConfirm({
      title: "删除频道",
      message: `确定要删除频道"${channel.displayName}"吗？`,
      danger: true,
      onConfirm: async () => {
        try {
          const response = await fetch("/api/dailymotion-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete",
              id: channel.id,
            }),
          });

          const result = await response.json();
          if (result.code === 200) {
            onChannelsChange(
              result.data.channels,
              result.data.defaultChannelId
            );
            onShowToast({ message: "频道删除成功", type: "success" });
          } else {
            throw new Error(result.message);
          }
        } catch (error) {
          onShowToast({
            message: error instanceof Error ? error.message : "删除失败",
            type: "error",
          });
        }
      },
    });
  };

  const handleSetDefault = async (channelId: string) => {
    try {
      const response = await fetch("/api/dailymotion-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setDefault",
          id: channelId,
        }),
      });

      const result = await response.json();
      if (result.code === 200) {
        onChannelsChange(result.data.channels, result.data.defaultChannelId);
        onShowToast({ message: "默认频道设置成功", type: "success" });
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      onShowToast({
        message: error instanceof Error ? error.message : "设置失败",
        type: "error",
      });
    }
  };

  const startEdit = (channel: DailymotionChannelConfig) => {
    setEditingId(channel.id);
    setFormData({
      username: channel.username,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl || "",
    });
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Sources List Container - matching VodSourcesTab */}
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">
              Dailymotion 频道管理
            </h2>
            {channels.length > 0 && (
              <span className="px-2 py-1 bg-[#E50914] text-white text-xs font-medium rounded-full">
                {channels.length} 个
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {channels.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="px-4 py-2 bg-[#333] hover:bg-red-600 text-white rounded-lg transition font-medium text-sm flex items-center gap-2"
              >
                <Trash2 size={16} />
                清空全部
              </button>
            )}
            <button
              onClick={() => setShowEncryptedImportModal(true)}
              className="px-4 py-2 bg-[#E50914] hover:bg-[#B20710] text-white rounded-lg transition font-medium text-sm flex items-center gap-2"
            >
              <Download size={16} />
              导入配置
            </button>
          </div>
        </div>

        {/* Add/Edit Modal */}
        {showModal && (
          <div
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={resetForm}
          >
            <div
              className="bg-[#1a1a1a] rounded-xl max-w-2xl w-full border border-[#333] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-[#333]">
                <h3 className="text-xl font-bold text-white">
                  {editingId ? "编辑频道" : "添加新频道"}
                </h3>
                <button
                  onClick={resetForm}
                  className="p-2 text-slate-400 hover:text-white hover:bg-[#333] rounded-lg transition"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      用户名 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) =>
                        setFormData({ ...formData, username: e.target.value })
                      }
                      placeholder="例如: kchow125"
                      className="w-full px-4 py-2 bg-slate-900/50 border border-[#333] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#E50914]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      显示名称 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.displayName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          displayName: e.target.value,
                        })
                      }
                      placeholder="例如: KChow125"
                      className="w-full px-4 py-2 bg-slate-900/50 border border-[#333] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#E50914]"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      头像 URL（可选）
                    </label>
                    <input
                      type="text"
                      value={formData.avatarUrl}
                      onChange={(e) =>
                        setFormData({ ...formData, avatarUrl: e.target.value })
                      }
                      placeholder="https://..."
                      className="w-full px-4 py-2 bg-slate-900/50 border border-[#333] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#E50914]"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-3 p-6 border-t border-[#333]">
                <button
                  onClick={resetForm}
                  className="px-6 py-2 bg-[#333] hover:bg-[#444] text-white rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={editingId ? handleUpdate : handleAdd}
                  className="px-6 py-2 bg-[#E50914] hover:bg-[#B20710] text-white rounded-lg transition"
                >
                  {editingId ? "更新" : "添加"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Channels List */}
        <div className="space-y-3">
          {channels.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="text-5xl mb-4">📺</div>
              <p className="text-lg mb-2">暂无频道配置</p>
              <p className="text-sm">点击上方「导入配置」按钮开始配置</p>
            </div>
          ) : (
            channels.map((channel) => (
              <div
                key={channel.id}
                className={`p-4 rounded-lg border transition ${
                  channel.id === defaultChannelId
                    ? "bg-[#E50914]/10 border-[#E50914]"
                    : "bg-[#141414] border-[#333] hover:border-[#555]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {channel.avatarUrl ? (
                      <img
                        src={channel.avatarUrl}
                        alt={channel.displayName}
                        className="w-12 h-12 rounded-full"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                        {channel.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-semibold">
                          {channel.displayName}
                        </h3>
                        {channel.id === defaultChannelId && (
                          <span className="text-xs px-2 py-1 bg-[#E50914] text-white rounded">
                            默认
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm">
                        @{channel.username}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {channel.id !== defaultChannelId && (
                      <button
                        onClick={() => handleSetDefault(channel.id)}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(channel)}
                      className="px-3 py-1 bg-[#E50914] hover:bg-[#B20710] text-white text-sm rounded transition"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(channel)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Encrypted Import Modal */}
      {showEncryptedImportModal && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={resetEncryptedImportModal}
        >
          <div
            className="bg-[#1a1a1a] rounded-xl max-w-2xl w-full border border-[#333] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-[#333]">
              <h3 className="text-xl font-bold text-white">导入订阅配置</h3>
              <button
                onClick={resetEncryptedImportModal}
                className="p-2 text-slate-400 hover:text-white hover:bg-[#333] rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  解密密码 <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-[#333] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#E50914]"
                  placeholder="输入加密时使用的密码"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  加密数据 / 订阅URL <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-[#333] rounded-lg text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-[#E50914] resize-none"
                  placeholder="粘贴加密字符串，或输入订阅 URL (https://...)"
                />
              </div>

              {decryptError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  ❌ {decryptError}
                </div>
              )}

              <button
                onClick={handleDecryptPreview}
                disabled={isDecrypting || !importPassword || !importData}
                className="w-full px-4 py-2 bg-[#E50914] hover:bg-[#B20710] disabled:bg-[#333] disabled:cursor-not-allowed text-white rounded-lg transition font-medium"
              >
                {isDecrypting ? "解密中..." : "🔓 解密预览"}
              </button>

              {importPreview && importPreview.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-300">
                      预览 ({importPreview.length} 个频道)
                    </h4>
                    <span className="text-xs text-green-400">✅ 解密成功</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 p-3 bg-[#141414] rounded-lg border border-[#333]">
                    {importPreview.map((channel, index) => (
                      <div
                        key={channel.username || index}
                        className="flex items-center gap-3 p-2 bg-slate-900/50 rounded"
                      >
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 text-sm">
                          {channel.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-white">
                            {channel.displayName}
                          </span>
                          <span className="text-slate-500 text-xs ml-2">
                            @{channel.username}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleConfirmEncryptedImport}
                    className="w-full px-4 py-2 bg-[#46d369] hover:bg-[#3cb85e] text-black font-medium rounded-lg transition"
                  >
                    ✅ 确认导入
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
