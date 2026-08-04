import versionInfo from '../version.json'

export const APP_VERSION = String(versionInfo.version || '14.2.0')
export const APP_VERSION_LABEL = APP_VERSION.replace(/\.0$/,'')
export const APP_UPDATED_AT = String(versionInfo.updatedAt || '04/08/2026')
