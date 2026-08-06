import versionInfo from '../version.json'

export const APP_VERSION = String(versionInfo.version || '16.5')
export const APP_VERSION_LABEL = APP_VERSION.replace(/\.0$/,'')
export const APP_UPDATED_AT = String(versionInfo.fecha || versionInfo.date || versionInfo.updatedAt || '05/08/2026')
