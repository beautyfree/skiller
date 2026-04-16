import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: "en", // default — overridden from saved settings on App startup
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes interpolated values
  },
});

export default i18n;
