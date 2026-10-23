// The step's English strings, registered when the step's code loads (D7 AR-D7-2: the step tables are not part of
// `/autorig`'s first visit). Every module of the step that reads `messages().rig` imports this file first. It is a
// side-effect module, listed in the package's `sideEffects`, so bundlers keep the bare import.
import { registerMessages } from '../../i18n';
import { rig } from '../../i18n/en/rig';

registerMessages('rig', rig);
