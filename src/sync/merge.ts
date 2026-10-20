/** 客户端拉取合并：远端时间戳 >= 本地即应用（平局由服务端/远端获胜）。 */
export function remoteWins(remoteUpdatedAt: number, localUpdatedAt: number | undefined): boolean {
  return localUpdatedAt === undefined || remoteUpdatedAt >= localUpdatedAt;
}
