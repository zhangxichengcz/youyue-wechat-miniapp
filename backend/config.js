'use strict';
function configuration() {
  return {
    templateId: process.env.REMINDER_TEMPLATE_ID || '',
    fields: { title: process.env.REMINDER_TITLE_FIELD || 'thing1', time: process.env.REMINDER_TIME_FIELD || 'time2', location: process.env.REMINDER_LOCATION_FIELD || 'thing3' },
    state: process.env.MINIPROGRAM_STATE || 'formal'
  };
}
module.exports = { configuration };
