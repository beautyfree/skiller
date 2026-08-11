/**
 * Classifies remote changes before any local skill reconciliation begins.
 * Documentation can advance independently; portable configuration and content
 * must keep the deliberate three-way review.
 */
export function isLibraryDocumentationOnlyUpdate(files: string[]): boolean {
  return files.length > 0 && files.every((file) => !(
    file === 'skills.json'
    || file === 'skills.lock'
    || file === 'dotagents.yaml'
    || file === 'resources.json'
    || file === '.gitignore'
    || /^(skills|instructions|commands|subagents)\//.test(file)
  ))
}

export function libraryDocumentationUpdatePlanId(
  workspacePlanId: string,
  files: string[],
  computePlanId: (payload: unknown) => string,
): string {
  return computePlanId({
    kind: 'library-documentation-update',
    schemaVersion: 1,
    workspacePlanId,
    files,
  })
}
