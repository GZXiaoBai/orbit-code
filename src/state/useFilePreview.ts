import { useMemo } from "react";
import { buildFilePreviewState } from "../domain/filePreview";

export function useFilePreview(activeFilePath: string | null, activeFileContent: string | null) {
  return useMemo(
    () => buildFilePreviewState(activeFilePath, activeFileContent),
    [activeFileContent, activeFilePath],
  );
}
