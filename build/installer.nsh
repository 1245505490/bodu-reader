; Register an Open With choice. The user's default Markdown application is preserved.
!macro customHeader
  !undef UNINSTALL_FILENAME
  !define UNINSTALL_FILENAME "卸载${PRODUCT_NAME}.exe"
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".markdown" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.Markdown" "" "Markdown 文档（${PRODUCT_NAME}）"
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.Markdown\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.Markdown\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "${APP_ID}.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "${APP_ID}.Markdown" ""
  CreateShortCut "$SMPROGRAMS\卸载${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\uninstallerIcon.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\卸载${PRODUCT_NAME}.lnk"
  ; Remove the cached installer while keeping preferences, drafts and history.
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\Classes\${APP_ID}.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "${APP_ID}.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "${APP_ID}.Markdown"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
