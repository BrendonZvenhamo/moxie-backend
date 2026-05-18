export interface MoodDecoration {
  emoji: string;
  header: string;
  footer: string;
  accent: string;
}

export function getMoodDecoration(purpose: string | undefined): MoodDecoration {
  switch (purpose) {
    case 'friendship':
      return {
        emoji: '🤝',
        header: '✨ MOXIE FRIENDSHIP ✨',
        footer: '☕ *Chilled Vibes*',
        accent: '🔹',
      };
    case 'dating':
      return {
        emoji: '💘',
        header: '🌹 MOXIE DATING 🌹',
        footer: '✨ *The Spark*',
        accent: '❤️',
      };
    default:
      return {
        emoji: '🌟',
        header: '🦁 MOXIE EXPLORE 🦁',
        footer: '🚀 *Find Your People*',
        accent: '✨',
      };
  }
}
