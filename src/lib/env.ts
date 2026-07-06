// NODE_ENV ist auf Vercel für Preview- UND Production-Deployments gleichermaßen
// "production" – als echte Unterscheidung dient VERCEL_ENV ("production" |
// "preview" | "development"), das nur bei echten Production-Deployments
// "production" ist. Läuft der Code nicht auf Vercel (VERCEL_ENV fehlt, z. B.
// lokales `next start` nach einem Production-Build), greift NODE_ENV als Fallback.
export function isRealProduction(): boolean {
  return process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
}
