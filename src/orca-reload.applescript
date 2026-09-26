-- Run by the kit as `osascript orca-reload.applescript <Orca.app path>`, after
-- a project was removed (#343, ADR 0024).
--
-- Orca's window keeps a removed project in its sidebar until the window is
-- rebuilt (stablyai/orca#23224; once a release fixes it, this can go behind a
-- version check), and its menu item Force Reload rebuilds it. This has System Events
-- click that item in the Orca at <Orca.app path>, and in no other app. The
-- item's name is localized, so it is also known by the shortcut the menu draws
-- after a tab, Orca's own ⌘⇧R. It prints `reloaded` only when it clicked; no
-- such Orca or no such item prints something else, and anything macOS refuses
-- is an error. The kit reads all of those the same way.

on run argv
	set appPath to item 1 of argv
	tell application "System Events"
		repeat with candidate in (every application process whose name is "Orca")
			if POSIX path of application file of candidate is appPath then
				tell candidate
					-- Menu 1 is Apple's own.
					repeat with b from 2 to count of menu bar items of menu bar 1
						set m to menu 1 of menu bar item b of menu bar 1
						set labels to name of menu items of m
						repeat with i from 1 to count of labels
							set label to item i of labels
							if label is not missing value then
								if label is "Force Reload" or label starts with ("Force Reload" & tab) or label ends with (tab & "⌘⇧R") then
									click menu item i of m
									return "reloaded"
								end if
							end if
						end repeat
					end repeat
				end tell
				return "no Force Reload in Orca's menus"
			end if
		end repeat
	end tell
	return "no Orca running from " & appPath
end run
