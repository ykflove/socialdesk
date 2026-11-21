'use strict';
// Networks without a public posting API. At publish time the post is marked
// "Ready to post" and shows up in the Reminders panel with its media + caption.
function manual(id, label, color, text, help) {
  return {
    id, label, color, manual: true,
    limits: { text, images: 10, video: true },
    fields: [
      { key: 'profileName', label: 'Profile name', placeholder: 'mybrand' },
      { key: 'note', label: 'Note (optional)', help },
    ],
    async verify(c) { return { name: c.profileName || label, handle: '@' + (c.profileName || label.toLowerCase()), avatar: null }; },
    async publish() { return { manual: true }; },
  };
}

module.exports = {
  snapchat: manual('snapchat', 'Snapchat', '#fffc00', 250,
    'Snapchat has no public API for posting Stories/Spotlight. At the scheduled time you get a reminder with the media ready to download and the caption ready to copy.'),
  reminder: manual('reminder', 'Reminder (any network)', '#8b8d98', 100000,
    'Use for any network without an API (e.g. WhatsApp Channels, Google Business Profile). You get a reminder at the scheduled time.'),
};
