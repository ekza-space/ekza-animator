// The step's English strings, registered when the step's code loads (D7 AR-D7-2: the step tables are not part of
// `/autorig`'s first visit). Every module of the step that reads `messages().markers` imports this file first.
import { registerMessages } from '../../i18n';
import { markers } from '../../i18n/en/markers';

registerMessages('markers', markers);
