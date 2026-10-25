import { createPluginHostClient } from '@wonderland/plugin-ui-sdk'

export interface PluginInfo {
  id: string
  name: string
  version: string
}

export const host = createPluginHostClient('wla_template_plugin')

export const pluginApi = {
  getInfo: () => host.call<PluginInfo>('get_info'),
  openDetails: () => host.openWorkspaceView('details'),
}
