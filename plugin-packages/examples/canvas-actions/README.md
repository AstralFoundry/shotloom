# Canvas actions sample

This package demonstrates one plugin with video and image canvas actions, a shared connection, declared parameters, asynchronous tasks, cancellation and multiple outputs. It copies media through a local mock service; it does not perform AI processing.

Start `node plugin-packages/examples/canvas-actions-service.mjs`, pack this directory with `npm run plugin -- pack plugin-packages/examples/canvas-actions /tmp/canvas-actions.shotloom-plugin`, then inspect and install that file in Shotloom desktop. Executable code requires explicit trust.

Save a project and import a video or image. Select it, open the toolbar's More menu and choose the processing sample. Select the local connection and number of copies. Results are saved as new associated media nodes. Actions can also be pinned in toolbar customization or opened from the node context menu.

The same actions are available to the canvas Agent through `inspect_plugin_capabilities`, `prepare_plugin_action` and `run_plugin_action`, subject to the user's node execution setting and normal approval rules.

For real services, replace the runtime and capability declarations with verified service contracts. Never label this sample as video enhancement or subtitle removal.
