export interface DiffChange {
  type: "added" | "removed" | "normal";
  value: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function computeLineDiff(oldStr: string, newStr: string): DiffChange[] {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  
  const M = oldLines.length;
  const N = newLines.length;
  
  // DP table for LCS
  const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));
  
  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find diff
  const changes: DiffChange[] = [];
  let i = M;
  let j = N;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({
        type: "normal",
        value: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({
        type: "added",
        value: newLines[j - 1],
        newLineNumber: j
      });
      j--;
    } else {
      changes.unshift({
        type: "removed",
        value: oldLines[i - 1],
        oldLineNumber: i
      });
      i--;
    }
  }
  
  return changes;
}
