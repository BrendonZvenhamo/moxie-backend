/**
 * Smart Dictionary for Semantic Interest Matching
 * Maps common variations and synonyms to a unified "cluster token".
 *
 * SCALE NOTES:
 * - Clusters are intentionally broad to reduce false negatives at scale.
 * - Ambiguous terms (e.g. "league", "rock") are intentionally omitted or
 *   mapped conservatively � prefer missing a match over a wrong cluster.
 * - isTypo() uses Levenshtein distance (not naive char diffing).
 * - Multi-word keys must be matched BEFORE tokenization � callers should
 *   pass the raw phrase, not individual words.
 */
export const INTEREST_CLUSTERS: Record<string, string> = {

  // --- SPORTS & FITNESS ----------------------------------------------------
  'football':          'sports_cluster',
  'soccer':            'sports_cluster',
  'basketball':        'sports_cluster',
  'baseball':          'sports_cluster',
  'cricket':           'sports_cluster',
  'volleyball':        'sports_cluster',
  'tennis':            'sports_cluster',
  'badminton':         'sports_cluster',
  'table tennis':      'sports_cluster',
  'ping pong':         'sports_cluster',
  'squash':            'sports_cluster',
  'rugby':             'sports_cluster',
  'american football': 'sports_cluster',
  'golf':              'sports_cluster',
  'hockey':            'sports_cluster',
  'ice hockey':        'sports_cluster',
  'cycling':           'sports_cluster',
  'swimming':          'sports_cluster',
  'running':           'sports_cluster',
  'jogging':           'sports_cluster',
  'marathon':          'sports_cluster',
  'triathlon':         'sports_cluster',
  'gymnastics':        'sports_cluster',
  'wrestling':         'sports_cluster',
  'boxing':            'sports_cluster',
  'mma':               'sports_cluster',
  'martial arts':      'sports_cluster',
  'karate':            'sports_cluster',
  'taekwondo':         'sports_cluster',
  'judo':              'sports_cluster',
  'skateboarding':     'sports_cluster',
  'surfing':           'sports_cluster',
  'snowboarding':      'sports_cluster',
  'skiing':            'sports_cluster',
  'archery':           'sports_cluster',
  'fencing':           'sports_cluster',
  'rowing':            'sports_cluster',
  'horse riding':      'sports_cluster',
  'equestrian':        'sports_cluster',
  'athletics':         'sports_cluster',
  'esports':           'sports_cluster', // competitive, not casual gaming
  'gym':               'sports_cluster',
  'fitness':           'sports_cluster',
  'workout':           'sports_cluster',
  'weightlifting':     'sports_cluster',
  'powerlifting':      'sports_cluster',
  'crossfit':          'sports_cluster',
  'pilates':           'sports_cluster',
  'yoga':              'sports_cluster',
  'stretching':        'sports_cluster',
  'calisthenics':      'sports_cluster',
  'bodybuilding':      'sports_cluster',

  // --- GAMING --------------------------------------------------------------
  'game':              'gaming_cluster',
  'games':             'gaming_cluster',
  'gaming':            'gaming_cluster',
  'gamer':             'gaming_cluster',
  'video games':       'gaming_cluster',
  'pc gaming':         'gaming_cluster',
  'console gaming':    'gaming_cluster',
  'mobile gaming':     'gaming_cluster',
  'minecraft':         'gaming_cluster',
  'roblox':            'gaming_cluster',
  'pubg':              'gaming_cluster',
  'fortnite':          'gaming_cluster',
  'valorant':          'gaming_cluster',
  'call of duty':      'gaming_cluster',
  'cod':               'gaming_cluster',
  'apex legends':      'gaming_cluster',
  'gta':               'gaming_cluster',
  'grand theft auto':  'gaming_cluster',
  'fifa':              'gaming_cluster',
  'pes':               'gaming_cluster',
  'counter strike':    'gaming_cluster',
  'cs2':               'gaming_cluster',
  'dota':              'gaming_cluster',
  'overwatch':         'gaming_cluster',
  'elden ring':        'gaming_cluster',
  'zelda':             'gaming_cluster',
  'pokemon':           'gaming_cluster',
  'mario':             'gaming_cluster',
  'playstation':       'gaming_cluster',
  'xbox':              'gaming_cluster',
  'nintendo':          'gaming_cluster',
  'switch':            'gaming_cluster',
  'steam':             'gaming_cluster',
  'twitch':            'gaming_cluster',
  'streamer':          'gaming_cluster',
  'game streaming':    'gaming_cluster',
  'speedrunning':      'gaming_cluster',
  'retro gaming':      'gaming_cluster',
  'tabletop':          'gaming_cluster',
  'board games':       'gaming_cluster',
  'card games':        'gaming_cluster',
  'chess':             'gaming_cluster',
  'checkers':          'gaming_cluster',
  'dungeons and dragons': 'gaming_cluster',
  'dnd':               'gaming_cluster',

  // --- TECH & DEVELOPMENT --------------------------------------------------
  'coding':            'tech_cluster',
  'programming':       'tech_cluster',
  'developer':         'tech_cluster',
  'software':          'tech_cluster',
  'software engineering': 'tech_cluster',
  'web development':   'tech_cluster',
  'web design':        'tech_cluster',
  'app development':   'tech_cluster',
  'mobile development': 'tech_cluster',
  'game development':  'tech_cluster',
  'open source':       'tech_cluster',
  'devops':            'tech_cluster',
  'docker':            'tech_cluster',
  'kubernetes':        'tech_cluster',
  'ci/cd':             'tech_cluster',
  'linux':             'tech_cluster',
  'unix':              'tech_cluster',
  'bash':              'tech_cluster',
  'terminal':          'tech_cluster',
  'python':            'tech_cluster',
  'javascript':        'tech_cluster',
  'typescript':        'tech_cluster',
  'react':             'tech_cluster',
  'vue':               'tech_cluster',
  'angular':           'tech_cluster',
  'nextjs':            'tech_cluster',
  'node':              'tech_cluster',
  'nodejs':            'tech_cluster',
  'rust':              'tech_cluster',
  'go':                'tech_cluster',
  'golang':            'tech_cluster',
  'java':              'tech_cluster',
  'kotlin':            'tech_cluster',
  'swift':             'tech_cluster',
  'flutter':           'tech_cluster',
  'c++':               'tech_cluster',
  'cpp':               'tech_cluster',
  'c#':                'tech_cluster',
  'php':               'tech_cluster',
  'ruby':              'tech_cluster',
  'sql':               'tech_cluster',
  'databases':         'tech_cluster',
  'api':               'tech_cluster',
  'rest api':          'tech_cluster',
  'graphql':           'tech_cluster',
  'frontend':          'tech_cluster',
  'backend':           'tech_cluster',
  'fullstack':         'tech_cluster',
  'cloud':             'tech_cluster',
  'aws':               'tech_cluster',
  'azure':             'tech_cluster',
  'gcp':               'tech_cluster',
  'cybersecurity':     'tech_cluster',
  'hacking':           'tech_cluster',
  'ethical hacking':   'tech_cluster',
  'networking':        'tech_cluster',
  'hardware':          'tech_cluster',
  'electronics':       'tech_cluster',
  'embedded systems':  'tech_cluster',
  'arduino':           'tech_cluster',
  'raspberry pi':      'tech_cluster',
  'robotics':          'tech_cluster',
  'ai':                'tech_cluster',
  'machine learning':  'tech_cluster',
  'deep learning':     'tech_cluster',
  'neural networks':   'tech_cluster',
  'nlp':               'tech_cluster',
  'computer vision':   'tech_cluster',
  'data science':      'tech_cluster',
  'data engineering':  'tech_cluster',
  'data':              'tech_cluster',
  'blockchain':        'tech_cluster',
  'web3':              'tech_cluster',
  'automation':        'tech_cluster',
  '3d printing':       'tech_cluster',

  // --- FOOD & DRINK --------------------------------------------------------
  'cooking':           'food_cluster',
  'coking':            'food_cluster', // typo catch � keep
  'baking':            'food_cluster',
  'chef':              'food_cluster',
  'cook':              'food_cluster',
  'food':              'food_cluster',
  'eating':            'food_cluster',
  'foodie':            'food_cluster',
  'vegan':             'food_cluster',
  'vegetarian':        'food_cluster',
  'restaurant':        'food_cluster',
  'coffee':            'food_cluster',
  'tea':               'food_cluster',
  'wine':              'food_cluster',
  'beer':              'food_cluster',
  'cocktails':         'food_cluster',
  'pizza':             'food_cluster',
  'sushi':             'food_cluster',
  'ramen':             'food_cluster',
  'bbq':               'food_cluster',
  'barbecue':          'food_cluster',
  'grilling':          'food_cluster',
  'meal prep':         'food_cluster',
  'nutrition':         'food_cluster',
  'diet':              'food_cluster',
  'pastry':            'food_cluster',
  'bread making':      'food_cluster',
  'fermentation':      'food_cluster',
  'street food':       'food_cluster',
  'fast food':         'food_cluster',
  'fine dining':       'food_cluster',
  'recipe':            'food_cluster',
  'recipes':           'food_cluster',

  // --- MUSIC ---------------------------------------------------------------
  'music':             'music_cluster',
  'songs':             'music_cluster',
  'singing':           'music_cluster',
  'vocalist':          'music_cluster',
  'rapping':           'music_cluster',
  'rap':               'music_cluster',
  'hiphop':            'music_cluster',
  'hip hop':           'music_cluster',
  'rnb':               'music_cluster',
  'r&b':               'music_cluster',
  'afrobeats':         'music_cluster',
  'afropop':           'music_cluster',
  'amapiano':          'music_cluster',
  'jazz':              'music_cluster',
  'blues':             'music_cluster',
  'classical music':   'music_cluster',
  'opera':             'music_cluster',
  'pop music':         'music_cluster',
  'edm':               'music_cluster',
  'electronic music':  'music_cluster',
  'country music':     'music_cluster',
  'reggae':            'music_cluster',
  'gospel':            'music_cluster',
  'metal':             'music_cluster',
  'punk':              'music_cluster',
  'indie':             'music_cluster',
  'alternative':       'music_cluster',
  'guitar':            'music_cluster',
  'piano':             'music_cluster',
  'drums':             'music_cluster',
  'violin':            'music_cluster',
  'bass':              'music_cluster',
  'saxophone':         'music_cluster',
  'trumpet':           'music_cluster',
  'flute':             'music_cluster',
  'ukulele':           'music_cluster',
  'dj':                'music_cluster',
  'mixing':            'music_cluster',
  'producing':         'music_cluster',
  'music production':  'music_cluster',
  'beat making':       'music_cluster',
  'spotify':           'music_cluster',
  'concert':           'music_cluster',
  'festival':          'music_cluster',
  'vinyl':             'music_cluster',
  'karaoke':           'music_cluster',

  // --- TRAVEL & OUTDOORS ---------------------------------------------------
  'travel':            'travel_cluster',
  'travelling':        'travel_cluster',
  'traveling':         'travel_cluster',
  'backpacking':       'travel_cluster',
  'tourism':           'travel_cluster',
  'sightseeing':       'travel_cluster',
  'road trip':         'travel_cluster',
  'hiking':            'travel_cluster',
  'trekking':          'travel_cluster',
  'camping':           'travel_cluster',
  'nature':            'travel_cluster',
  'wildlife':          'travel_cluster',
  'bird watching':     'travel_cluster',
  'birdwatching':      'travel_cluster',
  'beach':             'travel_cluster',
  'ocean':             'travel_cluster',
  'mountains':         'travel_cluster',
  'adventure':         'travel_cluster',
  'rock climbing':     'travel_cluster',
  'kayaking':          'travel_cluster',
  'sailing':           'travel_cluster',
  'diving':            'travel_cluster',
  'scuba diving':      'travel_cluster',
  'snorkeling':        'travel_cluster',
  'fishing':           'travel_cluster',
  'hunting':           'travel_cluster',
  'foraging':          'travel_cluster',
  'van life':          'travel_cluster',
  'solo travel':       'travel_cluster',
  'luxury travel':     'travel_cluster',
  'budget travel':     'travel_cluster',

  // --- ART & DESIGN --------------------------------------------------------
  'art':               'art_cluster',
  'drawing':           'art_cluster',
  'painting':          'art_cluster',
  'sketching':         'art_cluster',
  'illustration':      'art_cluster',
  'calligraphy':       'art_cluster',
  'sculpting':         'art_cluster',
  'pottery':           'art_cluster',
  'ceramics':          'art_cluster',
  'origami':           'art_cluster',
  'embroidery':        'art_cluster',
  'knitting':          'art_cluster',
  'crocheting':        'art_cluster',
  'sewing':            'art_cluster',
  'weaving':           'art_cluster',
  'photography':       'art_cluster',
  'photo editing':     'art_cluster',
  'videography':       'art_cluster',
  'video editing':     'art_cluster',
  'graphic design':    'art_cluster',
  'graphic':           'art_cluster',
  'ui design':         'art_cluster',
  'ux design':         'art_cluster',
  'design':            'art_cluster',
  'interior design':   'art_cluster',
  'fashion design':    'art_cluster',
  'digital art':       'art_cluster',
  'pixel art':         'art_cluster',
  'animation':         'art_cluster',
  '3d modeling':       'art_cluster',
  'blender':           'art_cluster',
  'anime':             'art_cluster',
  'manga':             'art_cluster',
  'comics':            'art_cluster',
  'graffiti':          'art_cluster',
  'street art':        'art_cluster',
  'printmaking':       'art_cluster',

  // --- READING & WRITING ---------------------------------------------------
  'reading':           'reading_cluster',
  'books':             'reading_cluster',
  'literature':        'reading_cluster',
  'novel':             'reading_cluster',
  'fiction':           'reading_cluster',
  'nonfiction':        'reading_cluster',
  'non-fiction':       'reading_cluster',
  'biography':         'reading_cluster',
  'memoir':            'reading_cluster',
  'self help':         'reading_cluster',
  'self-help':         'reading_cluster',
  'philosophy books':  'reading_cluster',
  'comic books':       'reading_cluster',
  'graphic novels':    'reading_cluster',
  'audiobooks':        'reading_cluster',
  'library':           'reading_cluster',
  'bookclub':          'reading_cluster',
  'book club':         'reading_cluster',
  'writing':           'reading_cluster',
  'creative writing':  'reading_cluster',
  'blogging':          'reading_cluster',
  'journalism':        'reading_cluster',
  'copywriting':       'reading_cluster',
  'screenwriting':     'reading_cluster',
  'poetry':            'reading_cluster',
  'prose':             'reading_cluster',
  'storytelling':      'reading_cluster',
  'author':            'reading_cluster',
  'fanfiction':        'reading_cluster',

  // --- MOVIES & ENTERTAINMENT ----------------------------------------------
  'movies':            'movie_cluster',
  'cinema':            'movie_cluster',
  'film':              'movie_cluster',
  'films':             'movie_cluster',
  'filmmaking':        'movie_cluster',
  'netflix':           'movie_cluster',
  'hulu':              'movie_cluster',
  'disney+':           'movie_cluster',
  'hbo':               'movie_cluster',
  'streaming':         'movie_cluster',
  'tv shows':          'movie_cluster',
  'television':        'movie_cluster',
  'tv':                'movie_cluster',
  'series':            'movie_cluster',
  'drama':             'movie_cluster',
  'sitcom':            'movie_cluster',
  'reality tv':        'movie_cluster',
  'documentary':       'movie_cluster',
  'anime series':      'movie_cluster',
  'horror movies':     'movie_cluster',
  'action movies':     'movie_cluster',
  'sci-fi movies':     'movie_cluster',
  'romance movies':    'movie_cluster',
  'comedy movies':     'movie_cluster',
  'youtube':           'movie_cluster',
  'content creation':  'movie_cluster',
  'podcasts':          'movie_cluster',
  'stand-up comedy':   'movie_cluster',
  'comedy':            'movie_cluster',
  'theatre':           'movie_cluster',
  'theater':           'movie_cluster',
  'broadway':          'movie_cluster',
  'improv':            'movie_cluster',
  'magic':             'movie_cluster',

  // --- FINANCE & BUSINESS --------------------------------------------------
  'finance':           'finance_cluster',
  'investing':         'finance_cluster',
  'stocks':            'finance_cluster',
  'stock market':      'finance_cluster',
  'trading':           'finance_cluster',
  'forex':             'finance_cluster',
  'day trading':       'finance_cluster',
  'options trading':   'finance_cluster',
  'crypto':            'finance_cluster',
  'cryptocurrency':    'finance_cluster',
  'bitcoin':           'finance_cluster',
  'ethereum':          'finance_cluster',
  'defi':              'finance_cluster',
  'nft':               'finance_cluster',
  'personal finance':  'finance_cluster',
  'budgeting':         'finance_cluster',
  'saving':            'finance_cluster',
  'financial planning':'finance_cluster',
  'real estate':       'finance_cluster',
  'business':          'finance_cluster',
  'entrepreneurship':  'finance_cluster',
  'entrepreneur':      'finance_cluster',
  'startup':           'finance_cluster',
  'startups':          'finance_cluster',
  'venture capital':   'finance_cluster',
  'marketing':         'finance_cluster',
  'digital marketing': 'finance_cluster',
  'e-commerce':        'finance_cluster',
  'dropshipping':      'finance_cluster',
  'sales':             'finance_cluster',
  'management':        'finance_cluster',
  'leadership':        'finance_cluster',
  'consulting':        'finance_cluster',
  'economics':         'finance_cluster',
  'accounting':        'finance_cluster',

  // --- SCIENCE -------------------------------------------------------------
  'science':           'science_cluster',
  'physics':           'science_cluster',
  'biology':           'science_cluster',
  'chemistry':         'science_cluster',
  'geology':           'science_cluster',
  'zoology':           'science_cluster',
  'botany':            'science_cluster',
  'ecology':           'science_cluster',
  'genetics':          'science_cluster',
  'neuroscience':      'science_cluster',
  'space':             'science_cluster',
  'astronomy':         'science_cluster',
  'astrophysics':      'science_cluster',
  'cosmology':         'science_cluster',
  'mathematics':       'science_cluster',
  'math':              'science_cluster',
  'statistics':        'science_cluster',
  'engineering':       'science_cluster',
  'electrical engineering': 'science_cluster',
  'mechanical engineering': 'science_cluster',
  'civil engineering': 'science_cluster',
  'chemical engineering':   'science_cluster',
  'quantum physics':   'science_cluster',
  'climate change':    'science_cluster',
  'environmental science':  'science_cluster',
  'meteorology':       'science_cluster',
  'oceanography':      'science_cluster',
  'paleontology':      'science_cluster',
  'archaeology':       'science_cluster',

  // --- HISTORY & HUMANITIES ------------------------------------------------
  // NOTE: split from science_cluster � these are NOT the same domain
  'history':           'humanities_cluster',
  'ancient history':   'humanities_cluster',
  'world history':     'humanities_cluster',
  'military history':  'humanities_cluster',
  'mythology':         'humanities_cluster',
  'philosophy':        'humanities_cluster',
  'ethics':            'humanities_cluster',
  'religion':          'humanities_cluster',
  'theology':          'humanities_cluster',
  'linguistics':       'humanities_cluster',
  'languages':         'humanities_cluster',
  'language learning': 'humanities_cluster',
  'culture':           'humanities_cluster',
  'anthropology':      'humanities_cluster',
  'sociology':         'humanities_cluster',
  'politics':          'humanities_cluster',
  'political science': 'humanities_cluster',
  'law':               'humanities_cluster',
  'geography':         'humanities_cluster',

  // --- HEALTH & WELLNESS ---------------------------------------------------
  'health':            'health_cluster',
  'wellness':          'health_cluster',
  'meditation':        'health_cluster',
  'mindfulness':       'health_cluster',
  'mental health':     'health_cluster',
  'psychology':        'health_cluster',
  'therapy':           'health_cluster',
  'self care':         'health_cluster',
  'self-care':         'health_cluster',
  'sleep':             'health_cluster',
  'intermittent fasting': 'health_cluster',
  'herbalism':         'health_cluster',
  'alternative medicine': 'health_cluster',
  'skincare':          'health_cluster',
  'grooming':          'health_cluster',
  'dental health':     'health_cluster',
  'journaling':        'health_cluster',

  // --- FASHION & LIFESTYLE -------------------------------------------------
  'fashion':           'fashion_cluster',
  'style':             'fashion_cluster',
  'streetwear':        'fashion_cluster',
  'sneakers':          'fashion_cluster',
  'thrifting':         'fashion_cluster',
  'vintage clothing':  'fashion_cluster',
  'luxury fashion':    'fashion_cluster',
  'makeup':            'fashion_cluster',
  'beauty':            'fashion_cluster',
  'nail art':          'fashion_cluster',
  'hair':              'fashion_cluster',
  'hairstyling':       'fashion_cluster',
  'accessories':       'fashion_cluster',
  'jewellery':         'fashion_cluster',
  'jewelry':           'fashion_cluster',
  'watches':           'fashion_cluster',
  'perfume':           'fashion_cluster',
  'fragrance':         'fashion_cluster',

  // --- SOCIAL & RELATIONSHIPS ----------------------------------------------
  'socializing':       'social_cluster',
  'community':         'social_cluster',
  'volunteering':      'social_cluster',
  'activism':          'social_cluster',
  'dating':            'social_cluster',
  'relationships':     'social_cluster',
  'parenting':         'social_cluster',
  'family':            'social_cluster',
  'friendship':        'social_cluster',
  'parties':           'social_cluster',
  'nightlife':         'social_cluster',
  'clubbing':          'social_cluster',

  // --- SPIRITUALITY & MINDSET ----------------------------------------------
  'spirituality':      'spirituality_cluster',
  'astrology':         'spirituality_cluster',
  'tarot':             'spirituality_cluster',
  'crystals':          'spirituality_cluster',
  'manifestation':     'spirituality_cluster',
  'law of attraction': 'spirituality_cluster',
  'stoicism':          'spirituality_cluster',
  'buddhism':          'spirituality_cluster',
  'christianity':      'spirituality_cluster',
  'islam':             'spirituality_cluster',
  'judaism':           'spirituality_cluster',
  'hinduism':          'spirituality_cluster',
  'paganism':          'spirituality_cluster',

  // --- PETS & ANIMALS ------------------------------------------------------
  'pets':              'pet_cluster',
  'animals':           'pet_cluster',
  'dogs':              'pet_cluster',
  'cats':              'pet_cluster',
  'birds':             'pet_cluster',
  'fish':              'pet_cluster',
  'reptiles':          'pet_cluster',
  'hamsters':          'pet_cluster',
  'rabbits':           'pet_cluster',
  'vet':               'pet_cluster',
  'veterinary':        'pet_cluster',
  'animal rescue':     'pet_cluster',
  'dog training':      'pet_cluster',
  'aquarium':          'pet_cluster',

  // --- HOME & DIY ----------------------------------------------------------
  'home improvement':  'home_cluster',
  'diy':               'home_cluster',
  'woodworking':       'home_cluster',
  'carpentry':         'home_cluster',
  'gardening':         'home_cluster',
  'houseplants':       'home_cluster',
  'landscaping':       'home_cluster',
  'home decor':        'home_cluster',
  'minimalism':        'home_cluster',
  'decluttering':      'home_cluster',
  'organization':      'home_cluster',
  'cleaning':          'home_cluster',
  'car repair':        'home_cluster',
  'car modification':  'home_cluster',

  // --- CARS & TRANSPORT ----------------------------------------------------
  'cars':              'cars_cluster',
  'car culture':       'cars_cluster',
  'automobiles':       'cars_cluster',
  'motorsport':        'cars_cluster',
  'formula 1':         'cars_cluster',
  'f1':                'cars_cluster',
  'nascar':            'cars_cluster',
  'rally':             'cars_cluster',
  'motorcycles':       'cars_cluster',
  'motorbikes':        'cars_cluster',
  'electric vehicles': 'cars_cluster',
  'ev':                'cars_cluster',
  'aviation':          'cars_cluster',
  'planes':            'cars_cluster',
  'trains':            'cars_cluster',

  // --- COLLECTING & HOBBIES ------------------------------------------------
  'collecting':        'hobbies_cluster',
  'stamp collecting':  'hobbies_cluster',
  'coin collecting':   'hobbies_cluster',
  'antiques':          'hobbies_cluster',
  'toys':              'hobbies_cluster',
  'action figures':    'hobbies_cluster',
  'model kits':        'hobbies_cluster',
  'lego':              'hobbies_cluster',
  'puzzles':           'hobbies_cluster',
  'escape rooms':      'hobbies_cluster',
  'trivia':            'hobbies_cluster',
  'astronomy hobby':   'hobbies_cluster',
  'stargazing':        'hobbies_cluster',
  'magic tricks':      'hobbies_cluster',
  'juggling':          'hobbies_cluster',
  'dance':             'hobbies_cluster',
  'dancing':           'hobbies_cluster',
  'ballet':            'hobbies_cluster',
  'salsa':             'hobbies_cluster',
  'ballroom':          'hobbies_cluster',
  'acting':            'hobbies_cluster',
  'cosplay':           'hobbies_cluster',
  'role playing':      'hobbies_cluster',
};

// --- TYPES --------------------------------------------------------------------

/**
 * Returned by normalizeInterest() for every input.
 *
 * confidence:
 *   1.0  � exact dictionary hit
 *   0.9  � stem match (suffix stripped)
 *   0.7  � typo corrected via BK-tree (edit distance 1)
 *   0.0  � no match found; cluster === null, term === cleaned input
 *
 * Use confidence in your logic to decide how much to trust the cluster:
 *   = 0.9  ? safe to act on
 *   0.7    ? usable but flag for review / A-B test
 *   0.0    ? unknown interest, store raw for manual review
 */
export interface MatchResult {
  cluster:    string | null;
  term:       string;        // the cleaned input that was matched
  matchedKey: string | null; // the dictionary key that triggered the match
  confidence: 1.0 | 0.9 | 0.7 | 0.0;
  method:     'exact' | 'stem' | 'typo' | 'none';
}

// --- INTERNALS ----------------------------------------------------------------

/**
 * Keys sorted longest-first so multi-word phrases ("machine learning") are
 * always checked before their substrings ("machine").
 * Built once at module load � O(n log n), paid once.
 */
const SORTED_KEYS: string[] = Object.keys(INTEREST_CLUSTERS)
  .sort((a, b) => b.length - a.length);

// --- BK-TREE -----------------------------------------------------------------
//
// A BK-tree stores strings in a metric space using Levenshtein distance.
// Insert: each node branches on exact edit distance from its parent.
// Query:  to find all words within distance d of a query q, visit only
//         branches whose edge label falls in [dist(q,node)-d, dist(q,node)+d].
// This prunes most of the tree, giving O(log n) average queries vs O(n) linear.
//
// We build it from SORTED_KEYS at module load. ~300 keys ? negligible cost.

interface BKNode {
  key:      string;
  children: Map<number, BKNode>;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99; // fast-reject

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }

  return prev[b.length];
}

function bkInsert(root: BKNode, key: string): void {
  let node = root;
  while (true) {
    const d = levenshtein(key, node.key);
    if (d === 0) return; // duplicate
    const child = node.children.get(d);
    if (!child) { node.children.set(d, { key, children: new Map() }); return; }
    node = child;
  }
}

function bkSearch(root: BKNode, query: string, maxDist: number): string[] {
  const results: string[] = [];
  const stack: BKNode[] = [root];

  while (stack.length) {
    const node = stack.pop()!;
    const d = levenshtein(query, node.key);
    if (d <= maxDist) results.push(node.key);
    for (const [edge, child] of node.children) {
      if (Math.abs(edge - d) <= maxDist) stack.push(child);
    }
  }

  return results;
}

// Build tree at module load from all dictionary keys
const BK_TREE: BKNode = { key: SORTED_KEYS[0], children: new Map() };
for (let i = 1; i < SORTED_KEYS.length; i++) bkInsert(BK_TREE, SORTED_KEYS[i]);

// --- NORMALISATION ------------------------------------------------------------

/**
 * Normalizes a single interest string.
 *
 * Pipeline (stops at first hit):
 *  1. Lowercase + trim
 *  2. Longest-first exact dictionary scan  ? confidence 1.0
 *  3. Suffix stripping, then exact lookup  ? confidence 0.9
 *  4. BK-tree typo search (edit dist = 1)  ? confidence 0.7
 *  5. Fallback: no cluster found           ? confidence 0.0
 *
 * Multi-word phrases work automatically because input arrives as a raw phrase
 * and SORTED_KEYS is sorted longest-first, so "machine learning" is tested
 * before "machine".
 */
export function normalizeInterest(interest: string): MatchResult {
  const term = interest.trim().toLowerCase();

  // 1. Exact match � longest key first guarantees multi-word priority
  for (const key of SORTED_KEYS) {
    if (term === key) {
      return { cluster: INTEREST_CLUSTERS[key], term, matchedKey: key, confidence: 1.0, method: 'exact' };
    }
  }

  // 2. Suffix stripping
  const suffixes = ['ings', 'ing', 'ers', 'er', 'es', 's'];
  for (const suffix of suffixes) {
    if (term.endsWith(suffix)) {
      const stem = term.slice(0, -suffix.length);
      if (INTEREST_CLUSTERS[stem]) {
        return { cluster: INTEREST_CLUSTERS[stem], term, matchedKey: stem, confidence: 0.9, method: 'stem' };
      }
    }
  }

  // 3. BK-tree typo search � only for inputs = 5 chars (avoids "go" ? "goo")
  if (term.length >= 5) {
    const candidates = bkSearch(BK_TREE, term, 1);
    if (candidates.length > 0) {
      // Pick the candidate closest in length to the input (ties: first found)
      const best = candidates.sort(
        (a, b) => Math.abs(a.length - term.length) - Math.abs(b.length - term.length)
      )[0];
      return { cluster: INTEREST_CLUSTERS[best], term, matchedKey: best, confidence: 0.7, method: 'typo' };
    }
  }

  // 4. No match
  return { cluster: null, term, matchedKey: null, confidence: 0.0, method: 'none' };
}

/**
 * Normalizes a list of interests, deduplicates by cluster, and returns all
 * MatchResults � including unmatched ones (confidence 0.0) so you can log them.
 *
 * Deduplication keeps the highest-confidence result per cluster.
 */
export function normalizeInterests(interests: string[]): MatchResult[] {
  const results = interests.map(normalizeInterest);

  // Deduplicate: keep highest confidence per cluster; keep all nulls (unknowns)
  const best = new Map<string, MatchResult>();
  const unknowns: MatchResult[] = [];

  for (const r of results) {
    if (r.cluster === null) { unknowns.push(r); continue; }
    const existing = best.get(r.cluster);
    if (!existing || r.confidence > existing.confidence) best.set(r.cluster, r);
  }

  return [...best.values(), ...unknowns];
}