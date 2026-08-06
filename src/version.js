import versionInfo from '../version.json'

export const APP_VERSION = String(versionInfo.version || '17.0')
export const APP_VERSION_NAME = String(versionInfo.name || versionInfo.nombre || 'Compacta')
export const APP_VERSION_LABEL = APP_VERSION.replace(/\.0$/,'')
export const APP_UPDATED_AT = String(versionInfo.fecha || versionInfo.date || versionInfo.updatedAt || '06/08/2026')
