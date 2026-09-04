const INTENT_DEFINITIONS = [
  {
    key: 'get_lunch_today',
    samples: [
      "what's for lunch today",
      "what's for lunch",
      "what's on the school lunch menu",
      "what's on the lunch menu",
      "what is the school lunch today",
      "what are we having for lunch today",
      "what's the lunch menu",
      "tell me the school lunch menu"
    ]
  },
  {
    key: 'get_lunch_tomorrow',
    samples: [
      "what's for school lunch tomorrow",
      "what's tomorrow's lunch menu",
      "what are we eating tomorrow",
      "what's for lunch tomorrow",
      "what is the school lunch menu tomorrow",
      "what will we have for lunch tomorrow",
      "what's tomorrow's school lunch"
    ]
  },
  {
    key: 'help',
    samples: [
      "help",
      "what can you do",
      "how do I use this"
    ]
  },
  {
    key: 'exit',
    samples: [
      "stop",
      "cancel",
      "goodbye",
      "never mind"
    ]
  }
];

module.exports = { INTENT_DEFINITIONS };
