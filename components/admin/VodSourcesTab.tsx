"use client";

import { useState } from "react";
import { VodSource } from "@/types/drama";
import { ShortDramaSource } from "@/types/shorts-source";
import { DailymotionChannelConfig } from "@/types/dailymotion-config";
import { Modal } from "@/components/Modal";
import type { VodSourcesTabProps } from "./types";
import { isSubscriptionUrl } from "@/lib/utils";

// 统一导入预览类型
interface UnifiedImportPreview {
  vodSources?: VodSource[];
  shortsSources?: ShortDramaSource[];
  dailymotionChannels?: Omit<DailymotionChannelConfig, "id" | "createdAt">[];
}

export function VodSourcesTab({
  sources,
  selectedKey,
  onSourcesChange,
  onSelectedKeyChange,
  onShowToast,
  onShowConfirm,
  unifiedImport,
}: VodSourcesTabProps) {
  const [editingSource, setEditingSource] = useState<VodSource | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [formData, setFormData] = useState<VodSource>({
    key: "",
    name: "",
    api: "",
    playUrl: "",
    usePlayUrl: true,
    priority: 0,
    type: "json",
  });

  // 加密导入相关状态
  const [showEncryptedImportModal, setShowEncryptedImportModal] =
    useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importData, setImportData] = useState("");
  const [importPreview, setImportPreview] = useState<VodSource[] | null>(null);
  // 统一导入预览（包含所有类型）
  const [unifiedPreview, setUnifiedPreview] =
    useState<UnifiedImportPreview | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState("");
  // 导入模式: "replace" = 替换全部, "merge" = 保留并合并
  const [importMode, setImportMode] = useState<"replace" | "merge">("merge");

  // 重置加密导入弹窗状态
  const resetEncryptedImportModal = () => {
    setShowEncryptedImportModal(false);
    setImportPassword("");
    setImportData("");
    setImportPreview(null);
    setUnifiedPreview(null);
    setIsDecrypting(false);
    setDecryptError("");
    setImportMode("merge");
  };

  // 解密预览 - 统一导入，解析所有类型
  const handleDecryptPreview = async () => {
    if (!importPassword || !importData) {
      setDecryptError("请输入密码和加密数据");
      return;
    }

    setIsDecrypting(true);
    setDecryptError("");
    setImportPreview(null);
    setUnifiedPreview(null);

    try {
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

      // 构建统一预览对象
      const preview: UnifiedImportPreview = {};
      if (payload.vodSources && payload.vodSources.length > 0) {
        preview.vodSources = payload.vodSources;
        setImportPreview(payload.vodSources);
      }
      if (payload.shortsSources && payload.shortsSources.length > 0) {
        preview.shortsSources = payload.shortsSources;
      }
      if (
        payload.dailymotionChannels &&
        payload.dailymotionChannels.length > 0
      ) {
        preview.dailymotionChannels = payload.dailymotionChannels;
      }

      if (Object.keys(preview).length === 0) {
        setDecryptError("配置中没有任何可导入的数据");
      } else {
        setUnifiedPreview(preview);
      }
    } catch (error) {
      setDecryptError(error instanceof Error ? error.message : "解密失败");
    } finally {
      setIsDecrypting(false);
    }
  };

  // 统一导入 - 导入所有类型的源
  const handleConfirmEncryptedImport = async () => {
    if (!unifiedPreview) return;

    const results: string[] = [];
    let hasError = false;

    try {
      // 1. 导入 VOD 源
      if (unifiedPreview.vodSources && unifiedPreview.vodSources.length > 0) {
        let finalSources: VodSource[];
        let finalSelected: string | null;

        let vodResultMsg = "";
        if (importMode === "merge") {
          // 合并模式：保留现有，跳过重复（按 key 判断）
          const existingKeys = new Set(sources.map((s) => s.key));
          const newSources = unifiedPreview.vodSources.filter(
            (s) => !existingKeys.has(s.key)
          );
          finalSources = [...sources, ...newSources];
          finalSelected = selectedKey || finalSources[0]?.key || null;
          vodResultMsg = `视频源 +${newSources.length} 个${
            newSources.length < unifiedPreview.vodSources.length
              ? `（跳过 ${
                  unifiedPreview.vodSources.length - newSources.length
                } 个重复）`
              : ""
          }`;
        } else {
          // 替换模式
          finalSources = unifiedPreview.vodSources;
          finalSelected = unifiedPreview.vodSources[0]?.key || null;
          vodResultMsg = `视频源 ${unifiedPreview.vodSources.length} 个（已替换）`;
        }

        const response = await fetch("/api/vod-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sources: finalSources,
            selected: finalSelected,
          }),
        });
        const result = await response.json();
        if (result.code === 200) {
          onSourcesChange(finalSources);
          if (finalSelected) onSelectedKeyChange(finalSelected);
          results.push(vodResultMsg);
        } else {
          hasError = true;
          results.push(`视频源导入失败: ${result.message || "未知错误"}`);
        }
      }

      // 2. 导入短剧源
      if (
        unifiedPreview.shortsSources &&
        unifiedPreview.shortsSources.length > 0 &&
        unifiedImport
      ) {
        // 先获取当前短剧源
        const shortsResponse = await fetch("/api/shorts-sources");
        const shortsData = await shortsResponse.json();
        const existingShortsSources: ShortDramaSource[] =
          shortsData.data?.sources || [];
        const existingShortsSelected: string =
          shortsData.data?.selected?.key || "";

        let finalSources: ShortDramaSource[];
        let finalSelected: string | null;

        let shortsResultMsg = "";
        if (importMode === "merge") {
          const existingKeys = new Set(existingShortsSources.map((s) => s.key));
          const newSources = unifiedPreview.shortsSources.filter(
            (s) => !existingKeys.has(s.key)
          );
          finalSources = [...existingShortsSources, ...newSources];
          finalSelected =
            existingShortsSelected || finalSources[0]?.key || null;
          shortsResultMsg = `短剧源 +${newSources.length} 个${
            newSources.length < unifiedPreview.shortsSources.length
              ? `（跳过 ${
                  unifiedPreview.shortsSources.length - newSources.length
                } 个重复）`
              : ""
          }`;
        } else {
          finalSources = unifiedPreview.shortsSources;
          finalSelected = unifiedPreview.shortsSources[0]?.key || null;
          shortsResultMsg = `短剧源 ${unifiedPreview.shortsSources.length} 个（已替换）`;
        }

        const response = await fetch("/api/shorts-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sources: finalSources,
            selected: finalSelected,
          }),
        });
        const result = await response.json();
        if (result.code === 200) {
          unifiedImport.onShortsSourcesImport(
            finalSources,
            finalSelected || undefined
          );
          results.push(shortsResultMsg);
        } else {
          hasError = true;
          results.push(`短剧源导入失败: ${result.message || "未知错误"}`);
        }
      }

      // 3. 导入 Dailymotion 频道
      if (
        unifiedPreview.dailymotionChannels &&
        unifiedPreview.dailymotionChannels.length > 0 &&
        unifiedImport
      ) {
        // 获取现有频道
        const dmResponse = await fetch("/api/dailymotion-config");
        const dmData = await dmResponse.json();
        const existingChannels: DailymotionChannelConfig[] =
          dmData.data?.channels || [];
        const existingUsernames = new Set(
          existingChannels.map((c) => c.username)
        );

        if (importMode === "replace") {
          // 替换模式：先清空再添加
          for (const channel of existingChannels) {
            await fetch("/api/dailymotion-config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", id: channel.id }),
            });
          }
          existingUsernames.clear();
        }

        let addedCount = 0;
        let skippedCount = 0;
        for (const channel of unifiedPreview.dailymotionChannels) {
          if (existingUsernames.has(channel.username)) {
            skippedCount++;
            continue;
          }
          const response = await fetch("/api/dailymotion-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add", ...channel }),
          });
          const result = await response.json();
          if (result.code === 200) {
            unifiedImport.onDailymotionImport(
              result.data.channels,
              result.data.defaultChannelId
            );
            existingUsernames.add(channel.username);
            addedCount++;
          }
        }
        if (addedCount > 0 || skippedCount > 0) {
          const msg =
            importMode === "merge"
              ? `Dailymotion +${addedCount} 个${
                  skippedCount > 0 ? `（跳过 ${skippedCount} 个重复）` : ""
                }`
              : `Dailymotion ${addedCount} 个（已替换）`;
          results.push(msg);
        }
      }

      if (results.length > 0) {
        onShowToast({
          message: hasError
            ? `⚠️ 部分导入完成: ${results.join("、")}`
            : `✅ 导入成功: ${results.join("、")}`,
          type: hasError ? "warning" : "success",
        });
      } else if (hasError) {
        onShowToast({ message: "导入失败，请重试", type: "error" });
      }

      resetEncryptedImportModal();
    } catch (error) {
      console.error("导入失败:", error);
      onShowToast({ message: "导入失败", type: "error" });
    }
  };

  const handleEdit = (source: VodSource) => {
    setFormData({ ...source });
    setEditingSource(source);
    setIsAddMode(false);
  };

  const handleDelete = (key: string) => {
    const sourceToDelete = sources.find((s) => s.key === key);
    onShowConfirm({
      title: "删除视频源",
      message: `确定要删除「${sourceToDelete?.name}」吗？`,
      onConfirm: async () => {
        try {
          const newSources = sources.filter((s) => s.key !== key);
          const newSelected =
            selectedKey === key && newSources.length > 0
              ? newSources[0].key
              : selectedKey;

          const response = await fetch("/api/vod-sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sources: newSources,
              selected: newSelected,
            }),
          });

          const result = await response.json();

          if (result.code === 200) {
            onSourcesChange(newSources);
            onSelectedKeyChange(newSelected);
            onShowToast({ message: "删除成功", type: "success" });
          } else {
            onShowToast({
              message: result.message || "删除失败",
              type: "error",
            });
          }
        } catch (error) {
          console.error("删除失败:", error);
          onShowToast({ message: "删除失败", type: "error" });
        }
      },
      danger: true,
    });
  };

  const handleSave = async () => {
    // playUrl 是可选的，不需要必填
    if (!formData.key || !formData.name || !formData.api) {
      onShowToast({ message: "请填写 Key、名称和 API 地址", type: "warning" });
      return;
    }

    let newSources: VodSource[];

    if (isAddMode) {
      if (sources.some((s) => s.key === formData.key)) {
        onShowToast({ message: "视频源key已存在", type: "error" });
        return;
      }
      newSources = [...sources, formData];
    } else {
      newSources = sources.map((s) =>
        s.key === editingSource?.key ? formData : s
      );
    }

    try {
      const response = await fetch("/api/vod-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: newSources,
          selected: selectedKey,
        }),
      });

      const result = await response.json();

      if (result.code === 200) {
        onSourcesChange(newSources);
        handleCancel();
        onShowToast({ message: "保存成功", type: "success" });
      } else {
        onShowToast({
          message: result.message || "保存失败",
          type: "error",
        });
      }
    } catch (error) {
      console.error("保存失败:", error);
      onShowToast({ message: "保存失败", type: "error" });
    }
  };

  const handleCancel = () => {
    setEditingSource(null);
    setIsAddMode(false);
  };

  const handleSelectSource = async (key: string) => {
    try {
      const response = await fetch("/api/vod-sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected: key }),
      });

      const result = await response.json();

      if (result.code === 200) {
        onSelectedKeyChange(key);
      } else {
        onShowToast({
          message: result.message || "选择失败",
          type: "error",
        });
      }
    } catch (error) {
      console.error("选择视频源失败:", error);
      onShowToast({ message: "选择失败", type: "error" });
    }
  };

  // 删除所有视频源
  const handleDeleteAll = () => {
    if (sources.length === 0) {
      onShowToast({ message: "没有可删除的视频源", type: "warning" });
      return;
    }

    onShowConfirm({
      title: "清空所有视频源",
      message: `确定要删除所有 ${sources.length} 个视频源吗？此操作不可撤销。`,
      onConfirm: async () => {
        try {
          const response = await fetch("/api/vod-sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sources: [],
              selected: null,
            }),
          });

          const result = await response.json();

          if (result.code === 200) {
            onSourcesChange([]);
            onSelectedKeyChange("");
            onShowToast({ message: "已清空所有视频源", type: "success" });
          } else {
            onShowToast({
              message: result.message || "清空失败",
              type: "error",
            });
          }
        } catch (error) {
          console.error("清空视频源失败:", error);
          onShowToast({ message: "清空失败", type: "error" });
        }
      },
      danger: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Edit/Add Modal */}
      <Modal
        isOpen={!!(editingSource || isAddMode)}
        onClose={handleCancel}
        title={isAddMode ? "添加视频源" : "编辑视频源"}
        size="lg"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Key (唯一标识)
            </label>
            <input
              type="text"
              value={formData.key}
              onChange={(e) =>
                setFormData({ ...formData, key: e.target.value })
              }
              disabled={!isAddMode}
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如: rycjapi"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              名称
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如: 如意资源站"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              API地址
            </label>
            <input
              type="text"
              value={formData.api}
              onChange={(e) =>
                setFormData({ ...formData, api: e.target.value })
              }
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              播放地址{" "}
              <span className="text-slate-500 font-normal">(可选)</span>
            </label>
            <input
              type="text"
              value={formData.playUrl || ""}
              onChange={(e) =>
                setFormData({ ...formData, playUrl: e.target.value })
              }
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="留空则直接使用原始播放链接"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              优先级{" "}
              <span className="text-slate-500 font-normal">
                (数值越小优先级越高)
              </span>
            </label>
            <input
              type="number"
              value={formData.priority ?? 0}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  priority: parseInt(e.target.value) || 0,
                })
              }
              min={0}
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.usePlayUrl ?? true}
                onChange={(e) =>
                  setFormData({ ...formData, usePlayUrl: e.target.checked })
                }
                className="w-5 h-5 rounded bg-slate-900/50 border-slate-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-sm text-slate-300">
                使用播放地址解析
                <span className="text-slate-500 ml-2">
                  (关闭则直接播放原始 m3u8 链接)
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-[#E50914] hover:bg-[#B20710] text-white rounded-lg transition font-medium"
          >
            保存
          </button>
          <button
            onClick={handleCancel}
            className="px-6 py-2 bg-[#333] hover:bg-[#444] text-white rounded-lg transition font-medium"
          >
            取消
          </button>
        </div>
      </Modal>

      {/* Sources List */}
      <div className="bg-[#1a1a1a] rounded-xl p-6 border border-[#333]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">已配置的视频源</h2>
            {sources.length > 0 && (
              <span className="px-2 py-1 bg-[#E50914] text-white text-xs font-medium rounded-full">
                {sources.length} 个
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowEncryptedImportModal(true)}
              className="px-4 py-2 bg-[#E50914] hover:bg-[#B20710] text-white rounded-lg transition font-medium text-sm flex items-center gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              导入配置
            </button>
            {sources.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="px-4 py-2 bg-[#333] hover:bg-red-600 text-slate-300 hover:text-white rounded-lg transition font-medium text-sm flex items-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                清空全部
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.key}
              className={`p-4 rounded-lg border transition ${
                selectedKey === source.key
                  ? "bg-[#E50914]/10 border-[#E50914]"
                  : "bg-[#141414] border-[#333] hover:border-[#555]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs px-2 py-1 bg-slate-600 text-slate-300 rounded font-mono">
                      #{source.priority ?? 0}
                    </span>
                    <h3 className="text-lg font-semibold text-white">
                      {source.name}
                    </h3>
                    <span className="text-xs px-2 py-1 bg-slate-700 text-slate-300 rounded">
                      {source.key}
                    </span>
                    {selectedKey === source.key && (
                      <span className="text-xs px-2 py-1 bg-[#E50914] text-white rounded">
                        当前使用
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-400 space-y-1">
                    <p>API: {source.api}</p>
                    {source.playUrl && (
                      <p>
                        播放: {source.playUrl}
                        {source.usePlayUrl === false && (
                          <span className="ml-2 text-yellow-500">(未启用)</span>
                        )}
                      </p>
                    )}
                    {!source.playUrl && (
                      <p className="text-slate-500">播放: 直接使用原始链接</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  {selectedKey !== source.key && (
                    <button
                      onClick={() => handleSelectSource(source.key)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                    >
                      设为当前
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(source)}
                    className="px-3 py-1 bg-[#E50914] hover:bg-[#B20710] text-white text-sm rounded transition"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(source.key)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          {sources.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <div className="text-5xl mb-4">📺</div>
              <p className="text-lg mb-2">暂无视频源配置</p>
              <p className="text-sm">点击上方「导入配置」按钮导入配置</p>
            </div>
          )}
        </div>
      </div>

      {/* Encrypted Import Modal */}
      <Modal
        isOpen={showEncryptedImportModal}
        onClose={resetEncryptedImportModal}
        title="导入订阅配置"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              解密密码 <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
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
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              placeholder="粘贴加密字符串，或输入订阅 URL (https://...)"
            />
            <p className="text-xs text-slate-500 mt-1">
              支持加密字符串或订阅 URL 两种方式导入
            </p>
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

          {unifiedPreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-300">解密成功</h4>
                <span className="text-xs text-green-400">✅ 包含以下配置</span>
              </div>

              {/* 统一预览列表 */}
              <div className="max-h-64 overflow-y-auto space-y-3 p-3 bg-[#141414] rounded-lg border border-[#333]">
                {/* VOD 源 */}
                {unifiedPreview.vodSources &&
                  unifiedPreview.vodSources.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[#E50914]">📺</span>
                        <span className="text-white font-medium">
                          视频源 ({unifiedPreview.vodSources.length} 个)
                        </span>
                      </div>
                      <div className="pl-6 space-y-1">
                        {unifiedPreview.vodSources
                          .slice(0, 3)
                          .map((source, idx) => (
                            <div
                              key={source.key || idx}
                              className="text-sm text-slate-400"
                            >
                              • {source.name}
                            </div>
                          ))}
                        {unifiedPreview.vodSources.length > 3 && (
                          <div className="text-xs text-slate-500">
                            ... 还有 {unifiedPreview.vodSources.length - 3} 个
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* 短剧源 */}
                {unifiedPreview.shortsSources &&
                  unifiedPreview.shortsSources.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[#E50914]">🎬</span>
                        <span className="text-white font-medium">
                          短剧源 ({unifiedPreview.shortsSources.length} 个)
                        </span>
                      </div>
                      <div className="pl-6 space-y-1">
                        {unifiedPreview.shortsSources
                          .slice(0, 3)
                          .map((source, idx) => (
                            <div
                              key={source.key || idx}
                              className="text-sm text-slate-400"
                            >
                              • {source.name}
                            </div>
                          ))}
                        {unifiedPreview.shortsSources.length > 3 && (
                          <div className="text-xs text-slate-500">
                            ... 还有 {unifiedPreview.shortsSources.length - 3}{" "}
                            个
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Dailymotion 频道 */}
                {unifiedPreview.dailymotionChannels &&
                  unifiedPreview.dailymotionChannels.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[#E50914]">📹</span>
                        <span className="text-white font-medium">
                          Dailymotion 频道 (
                          {unifiedPreview.dailymotionChannels.length} 个)
                        </span>
                      </div>
                      <div className="pl-6 space-y-1">
                        {unifiedPreview.dailymotionChannels
                          .slice(0, 3)
                          .map((channel, idx) => (
                            <div
                              key={channel.username || idx}
                              className="text-sm text-slate-400"
                            >
                              • {channel.displayName} (@{channel.username})
                            </div>
                          ))}
                        {unifiedPreview.dailymotionChannels.length > 3 && (
                          <div className="text-xs text-slate-500">
                            ... 还有{" "}
                            {unifiedPreview.dailymotionChannels.length - 3} 个
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* 导入模式选择 */}
              <div className="p-3 bg-[#141414] rounded-lg border border-[#333]">
                <div className="text-sm font-medium text-slate-300 mb-2">
                  导入模式
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setImportMode("merge")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition ${
                      importMode === "merge"
                        ? "bg-[#E50914] text-white"
                        : "bg-[#333] text-slate-300 hover:bg-[#444]"
                    }`}
                  >
                    <div className="font-medium">🔀 合并</div>
                    <div className="text-xs opacity-70">保留现有，跳过重复</div>
                  </button>
                  <button
                    onClick={() => setImportMode("replace")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition ${
                      importMode === "replace"
                        ? "bg-orange-600 text-white"
                        : "bg-[#333] text-slate-300 hover:bg-[#444]"
                    }`}
                  >
                    <div className="font-medium">🔄 替换</div>
                    <div className="text-xs opacity-70">清空后重新导入</div>
                  </button>
                </div>
              </div>

              <button
                onClick={handleConfirmEncryptedImport}
                className="w-full px-4 py-2 bg-[#46d369] hover:bg-[#3cb85e] text-black font-medium rounded-lg transition"
              >
                ✅ {importMode === "merge" ? "合并导入" : "替换导入"}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
