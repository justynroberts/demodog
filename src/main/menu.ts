// MIT License - Copyright (c) fintonlabs.com
import { app, Menu, shell, type BrowserWindow } from 'electron'
import { checkForUpdatesNow } from './updater'

/**
 * The application menu.
 *
 * There wasn't one, which cost more than it looks. On macOS the standard
 * editing shortcuts are provided *by the menu*: with no Edit menu there is no
 * Cmd-C or Cmd-V, so the caption editor and the preset name field could not be
 * copied into or out of. And a machine whose automatic update is not working
 * had no way to ask for one, or even to find out which version it was running.
 */
export function installMenu(window: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          label: 'Check for Updates…',
          click: () => {
            const target = window()
            if (target) void checkForUpdatesNow(target)
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [{ role: 'close' }]
    },
    {
      // Without this the standard shortcuts simply do not exist.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Releases and Downloads',
          click: () =>
            void shell.openExternal('https://github.com/justynroberts/demodog/releases')
        },
        {
          label: 'Reveal Update Log',
          click: () => shell.showItemInFolder(`${app.getPath('logs')}/updater.log`)
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
