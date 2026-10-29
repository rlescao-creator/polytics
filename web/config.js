// Connexion au projet Supabase poll-collector.
// La clé « publishable » est faite pour le navigateur : elle ne donne que ce que la RLS autorise.
window.POLL_CONFIG = {
  supabaseUrl: 'https://okbiuiqppdszgckglqzi.supabase.co',
  supabaseKey: 'sb_publishable_dvFaV6W6gFZMi4qp0xMQag_L7ZsCIoe',
  election: 'fr-2027',
  // Choix éditoriaux de l'accueil. Élections écartées des totaux des deux camps (leur ligne reste affichée).
  exclus: ['br-2026'],
  // Candidat le plus à droite de chaque duel final, pour mesurer un éventuel penchant des sondages
  // (classement de la rédaction ; Taïwan ne se lit pas sur l'axe gauche-droite).
  plusADroite: {
    'ar-2023': 'Milei', 'br-2026': 'Flávio Bolsonaro', 'cl-2025': 'Kast', 'co-2026': 'De la Espriella',
    'fr-2022': 'Le Pen', 'kr-2025': 'Kim Moon-soo', 'mx-2024': 'Gálvez', 'pe-2026': 'Fujimori',
    'pl-2025': 'Nawrocki', 'pt-2026': 'Ventura', 'ro-2025': 'Simion', 'us-2024': 'Trump',
  },
};
