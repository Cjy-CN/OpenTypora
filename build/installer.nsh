!include "LogicLib.nsh"

; Installer smoke tests can redirect these same macros to an isolated Classes tree.
!ifndef OPENTYPORA_CLASSES_ROOT
  !define OPENTYPORA_CLASSES_ROOT "Software\Classes"
!endif
!define OPENTYPORA_VERB "${OPENTYPORA_CLASSES_ROOT}\SystemFileAssociations\.md\shell\OpenTypora"
!define OPENTYPORA_APPLICATION "${OPENTYPORA_CLASSES_ROOT}\Applications\OpenTypora.exe"
!define OPENTYPORA_PROGID "${OPENTYPORA_CLASSES_ROOT}\OpenTypora.Markdown"
!define OPENTYPORA_OPENWITH "${OPENTYPORA_CLASSES_ROOT}\.md\OpenWithProgids"

; Language IDs are defined after electron-builder includes this file.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    LangString OpenTyporaOpenLabel ${LANG_ENGLISH} "Open with OpenTypora"
    LangString OpenTyporaOpenLabel ${LANG_SIMPCHINESE} "用 OpenTypora 打开"
  !endif
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend

!macro customInstall
  ; Per-user registration: keep the existing default editor and Windows UserChoice.
  WriteRegStr HKCU "${OPENTYPORA_VERB}" "" "$(OpenTyporaOpenLabel)"
  WriteRegStr HKCU "${OPENTYPORA_VERB}" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "${OPENTYPORA_VERB}" "MultiSelectModel" "Single"
  WriteRegStr HKCU "${OPENTYPORA_VERB}\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "${OPENTYPORA_APPLICATION}" "FriendlyAppName" "OpenTypora"
  WriteRegStr HKCU "${OPENTYPORA_APPLICATION}\SupportedTypes" ".md" ""
  WriteRegStr HKCU "${OPENTYPORA_APPLICATION}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "${OPENTYPORA_PROGID}" "" "OpenTypora Markdown"
  WriteRegStr HKCU "${OPENTYPORA_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "${OPENTYPORA_PROGID}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "${OPENTYPORA_OPENWITH}" "OpenTypora.Markdown" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Remove only registrations that still point to this installation.
  ReadRegStr $R0 HKCU "${OPENTYPORA_VERB}\command" ""
  ${If} $R0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey HKCU "${OPENTYPORA_VERB}"
  ${EndIf}
  ReadRegStr $R0 HKCU "${OPENTYPORA_APPLICATION}\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey HKCU "${OPENTYPORA_APPLICATION}"
  ${EndIf}
  ReadRegStr $R0 HKCU "${OPENTYPORA_PROGID}\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegValue HKCU "${OPENTYPORA_OPENWITH}" "OpenTypora.Markdown"
    ; NSIS /ifempty ignores values. Keep shared .md keys and other editors' values.
    DeleteRegKey HKCU "${OPENTYPORA_PROGID}"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
