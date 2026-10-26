# Appearance

Use the three buttons beside **外观** at the bottom of the sidebar:

- Sun: light.
- Moon: dark.
- Display: follow the system appearance.

The desktop app saves the selection in `appearance.json` in its local application data directory. It survives reloads and restarts, including changes to the local service port. System changes apply automatically only while following the system. A failed save keeps the previous selection and shows a retry message.

Theme changes preserve conversations, account selection and unsent drafts. Settings, account usage, code blocks, approvals and the logo follow the selected appearance.

The dark workspace canvas uses pure black (`#000000`), including the native window background. The sidebar, input and sheets retain elevated surfaces for visual separation.

Dark surfaces and text use neutral grayscale values: primary text `#f5f5f5`, body text `#e8e8e8`, secondary text `#c2c2c2`, subtle text `#a8a8a8`. Blue actions and semantic status colors retain their meaning.
