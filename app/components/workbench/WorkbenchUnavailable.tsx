import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Shown in the workbench's place on viewports too narrow to run it.
 *
 * This is not a layout concession — the editor, terminal and preview are all driven by
 * WebContainer, which needs SharedArrayBuffer and cross-origin isolation and is unsupported on
 * mobile browsers outright. Narrowing the panel would produce a surface that cannot work, so the
 * honest thing is to say so and hand the reader back to the chat, which works fine on a phone.
 */
export function WorkbenchUnavailable() {
  return (
    /*
     * Carries .z-workbench (3) like the panel it replaces, and paints its own background: the
     * chat's composer sits at z-index 2 and would otherwise draw over the notice, with messages
     * showing through behind it.
     */
    <div className="z-workbench fixed top-[var(--header-height)] bottom-0 left-0 w-full overflow-auto bg-bolt-elements-background-depth-1 px-4 py-6">
      <div className="mx-auto flex max-w-sm flex-col items-center rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 text-center">
        <div className="i-ph:desktop text-4xl text-bolt-elements-textSecondary" />

        <h2 className="mt-4 text-base font-semibold text-bolt-elements-textPrimary">
          The editor needs a bigger screen
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-bolt-elements-textSecondary">
          Your app is still being built — the code editor, terminal and live preview just can&apos;t run in a mobile
          browser. Open this project on a desktop to see them.
        </p>

        <p className="mt-2 text-sm leading-relaxed text-bolt-elements-textSecondary">
          You can keep chatting here in the meantime.
        </p>

        <button
          onClick={() => workbenchStore.showWorkbench.set(false)}
          className="mt-5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#ea5a0c]"
        >
          Back to chat
        </button>
      </div>
    </div>
  );
}
