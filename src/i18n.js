// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like the
// rest of guim31's integrations. The vocabulary follows the Gladys interface
// (front/src/config/i18n): "Ladestation", "Estación de carga"...
//
//   - NAMES    : the feature names, frozen when the user adds the device: the
//                language comes from the `language` field of the config;
//   - STATUS   : the detailed status of a charger (text feature, widget);
//   - TEXT     : the fixed texts (widget, configuration screen, actions);
//   - MESSAGES : the texts built from a value;
//   - thrown() : a THROWN message reaches the screen as a plain string, the
//                core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks that every entry carries exactly the four
// languages, none empty, none too long, and no polite German.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

export { LANGUAGES };

/** Feature names, by language then feature key. */
export const NAMES = {
  en: {
    connector: 'Connector',
    charging_state: 'Charging state',
    status: 'Zaptec status',
    power: 'Charging power',
    current_l1: 'Current L1',
    current_l2: 'Current L2',
    current_l3: 'Current L3',
    session_energy: 'Session energy',
    total_energy: 'Total energy',
    charge: 'Charging',
    available_current: 'Available current',
    max_current: 'Installation maximum',
  },
  fr: {
    connector: 'Connecteur',
    charging_state: 'État de la charge',
    status: 'Statut Zaptec',
    power: 'Puissance de charge',
    current_l1: 'Intensité L1',
    current_l2: 'Intensité L2',
    current_l3: 'Intensité L3',
    session_energy: 'Énergie de la session',
    total_energy: 'Énergie totale',
    charge: 'Charge',
    available_current: 'Courant disponible',
    max_current: "Maximum de l'installation",
  },
  de: {
    connector: 'Anschluss',
    charging_state: 'Ladezustand',
    status: 'Zaptec-Status',
    power: 'Ladeleistung',
    current_l1: 'Strom L1',
    current_l2: 'Strom L2',
    current_l3: 'Strom L3',
    session_energy: 'Energie der Ladung',
    total_energy: 'Gesamtenergie',
    charge: 'Laden',
    available_current: 'Verfügbarer Strom',
    max_current: 'Maximum der Installation',
  },
  es: {
    connector: 'Conector',
    charging_state: 'Estado de la carga',
    status: 'Estado Zaptec',
    power: 'Potencia de carga',
    current_l1: 'Intensidad L1',
    current_l2: 'Intensidad L2',
    current_l3: 'Intensidad L3',
    session_energy: 'Energía de la sesión',
    total_energy: 'Energía total',
    charge: 'Carga',
    available_current: 'Corriente disponible',
    max_current: 'Máximo de la instalación',
  },
};

/** Detailed status of a charger, by key (src/zaptec/model.js statusKey). */
export const STATUS = {
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  disconnected: {
    en: 'No vehicle',
    fr: 'Aucun véhicule',
    de: 'Kein Fahrzeug',
    es: 'Sin vehículo',
  },
  requesting: {
    en: 'Vehicle plugged in, waiting',
    fr: 'Véhicule branché, en attente',
    de: 'Fahrzeug angesteckt, wartet',
    es: 'Vehículo conectado, en espera',
  },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  paused: {
    en: 'Charging paused',
    fr: 'Charge en pause',
    de: 'Laden pausiert',
    es: 'Carga en pausa',
  },
  completed: {
    en: 'Charging completed',
    fr: 'Charge terminée',
    de: 'Laden abgeschlossen',
    es: 'Carga terminada',
  },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

/** Fixed texts. */
export const TEXT = {
  // Widget
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  online: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  onlineYes: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  onlineNo: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  session: { en: 'Session', fr: 'Session', de: 'Ladung', es: 'Sesión' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  stop: { en: 'End session', fr: 'Terminer', de: 'Beenden', es: 'Finalizar' },
  pickCharger: {
    en: 'Choose a charger in the widget settings.',
    fr: 'Choisissez une borne dans les réglages du widget.',
    de: 'Wähle eine Ladestation in den Einstellungen des Widgets.',
    es: 'Elija un cargador en los ajustes del widget.',
  },
  notACharger: {
    en: 'This device is not a Zaptec charger: choose a charger in the widget settings.',
    fr: "Cet appareil n'est pas une borne Zaptec : choisissez une borne dans les réglages du widget.",
    de: 'Dieses Gerät ist keine Zaptec-Ladestation: Wähle eine Ladestation in den Einstellungen des Widgets.',
    es: 'Este dispositivo no es un cargador Zaptec: elija un cargador en los ajustes del widget.',
  },
  notConfigured: {
    en: 'Fill in the e-mail address and the password of the Zaptec account.',
    fr: "Renseignez l'adresse e-mail et le mot de passe du compte Zaptec.",
    de: 'Gib die E-Mail-Adresse und das Passwort des Zaptec-Kontos ein.',
    es: 'Introduzca la dirección de correo electrónico y la contraseña de la cuenta Zaptec.',
  },
  noReadingYet: {
    en: 'No reading from the Zaptec cloud yet.',
    fr: 'Pas encore de relevé du cloud Zaptec.',
    de: 'Noch keine Messung aus der Zaptec-Cloud.',
    es: 'Todavía no hay lecturas de la nube Zaptec.',
  },

  // Configuration screen
  authRefused: {
    en: 'Zaptec refused the e-mail address and password. Check them, then save the configuration again.',
    fr: "Zaptec a refusé l'adresse e-mail et le mot de passe. Vérifiez-les, puis enregistrez de nouveau la configuration.",
    de: 'Zaptec hat die E-Mail-Adresse und das Passwort abgelehnt. Prüfe sie und speichere die Konfiguration erneut.',
    es: 'Zaptec ha rechazado la dirección de correo electrónico y la contraseña. Compruébelas y vuelva a guardar la configuración.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // Thrown, joined by thrown(): short, a widget toast is 200 characters at most.
  noVehicle: {
    en: 'No vehicle connected.',
    fr: 'Aucun véhicule branché.',
    de: 'Kein Fahrzeug verbunden.',
    es: 'Ningún vehículo conectado.',
  },
  notCharging: {
    en: 'Not charging: nothing to pause.',
    fr: 'Pas de charge en cours à mettre en pause.',
    de: 'Es wird nicht geladen: nichts zu pausieren.',
    es: 'No hay carga en curso que pausar.',
  },
  notPaused: {
    en: 'Only a paused charge can resume.',
    fr: 'Seule une charge en pause peut reprendre.',
    de: 'Nur eine pausierte Ladung geht weiter.',
    es: 'Solo se reanuda una carga en pausa.',
  },
  offlineCharger: {
    en: 'The charger is offline.',
    fr: 'La borne est hors ligne.',
    de: 'Die Ladestation ist offline.',
    es: 'El cargador está sin conexión.',
  },
  unknownCharger: {
    en: 'Unknown charger.',
    fr: 'Borne inconnue.',
    de: 'Unbekannte Ladestation.',
    es: 'Cargador desconocido.',
  },
  unknownInstallation: {
    en: 'Unknown installation.',
    fr: 'Installation inconnue.',
    de: 'Unbekannte Installation.',
    es: 'Instalación desconocida.',
  },
  notConfiguredShort: {
    en: 'Zaptec account not configured.',
    fr: 'Compte Zaptec non configuré.',
    de: 'Zaptec-Konto nicht eingerichtet.',
    es: 'Cuenta Zaptec no configurada.',
  },
  commandRefused: {
    en: 'Zaptec refused the command.',
    fr: 'Zaptec a refusé la commande.',
    de: 'Zaptec hat den Befehl abgelehnt.',
    es: 'Zaptec ha rechazado la orden.',
  },
  forbidden: {
    en: 'The Zaptec account lacks the rights (owner or service).',
    fr: 'Le compte Zaptec n’a pas les droits (propriétaire ou service).',
    de: 'Dem Zaptec-Konto fehlen die Rechte (Eigentümer oder Service).',
    es: 'La cuenta Zaptec no tiene permisos (propietario o servicio).',
  },
  cloudUnreachable: {
    en: 'Zaptec cloud unreachable.',
    fr: 'Cloud Zaptec injoignable.',
    de: 'Zaptec-Cloud nicht erreichbar.',
    es: 'Nube Zaptec inaccesible.',
  },
  rateLimited: {
    en: 'Too many requests to Zaptec, retry later.',
    fr: 'Trop de requêtes vers Zaptec, réessayez.',
    de: 'Zu viele Anfragen an Zaptec, später erneut.',
    es: 'Demasiadas solicitudes a Zaptec, reintente.',
  },
  badCurrent: {
    en: 'Available current: from 0 A to the installation maximum.',
    fr: "Courant disponible : de 0 A au maximum de l'installation.",
    de: 'Verfügbarer Strom: von 0 A bis zum Maximum der Installation.',
    es: 'Corriente disponible: de 0 A al máximo de la instalación.',
  },
};

/** Texts built from a value. Each one returns the four languages. */
export const MESSAGES = {
  connected: (chargers, installations) => ({
    en: `Connected to Zaptec: ${chargers} charger(s), ${installations} installation(s) with current control.`,
    fr: `Connecté à Zaptec : ${chargers} borne(s), ${installations} installation(s) avec réglage du courant.`,
    de: `Mit Zaptec verbunden: ${chargers} Ladestation(en), ${installations} Installation(en) mit Stromregelung.`,
    es: `Conectado a Zaptec: ${chargers} cargador(es), ${installations} instalación(es) con ajuste de corriente.`,
  }),
  unreachable: (detail) => ({
    en: `Cannot reach the Zaptec cloud: ${detail}`,
    fr: `Impossible de joindre le cloud Zaptec : ${detail}`,
    de: `Die Zaptec-Cloud ist nicht erreichbar: ${detail}`,
    es: `No se puede acceder a la nube Zaptec: ${detail}`,
  }),
  commandSent: (command, name) => {
    const labels = {
      stop_charging_final: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
      resume_charging: { en: 'Resume', fr: 'Reprise', de: 'Fortsetzen', es: 'Reanudación' },
      deauthorize_and_stop: {
        en: 'End session',
        fr: 'Fin de session',
        de: 'Sitzung beenden',
        es: 'Fin de sesión',
      },
    }[command];
    return {
      en: `Command "${labels.en}" sent to ${name}.`,
      fr: `Commande « ${labels.fr} » envoyée à ${name}.`,
      de: `Befehl „${labels.de}“ an ${name} gesendet.`,
      es: `Orden «${labels.es}» enviada a ${name}.`,
    };
  },
};

/**
 * A text in one language (the configured one), English when missing.
 * @param {Record<string, string>} text
 * @param {string} language
 */
export function pick(text, language) {
  return text[language] ?? text.en;
}

/**
 * A message to THROW: the core shows a thrown message as a plain string, so
 * the four languages are joined.
 * @param {{ en: string, fr: string, de: string, es: string }} text
 * @returns {string}
 */
export function thrown(text) {
  return LANGUAGES.map((lang) => text[lang]).join(' / ');
}
