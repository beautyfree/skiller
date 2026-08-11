import {
  compareToolkitSkill,
  previewNewToolkitFile,
  previewToolkitChangedFile,
  type ToolkitFileComparison,
  type ToolkitFilePreview,
} from 'dotagents/toolkit-review'

export type SyncConflictComparison = ToolkitFileComparison
export type SyncConflictFilePreview = ToolkitFilePreview

/** Compatibility names for Skiller's renderer RPC; all comparison logic lives in dotagents. */
export const buildBundledConflictComparison = compareToolkitSkill
export const previewBundledConflictFile = previewToolkitChangedFile
export const previewNewLocalBundleFile = previewNewToolkitFile
