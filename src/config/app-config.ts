import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Command Center",
  version: packageJson.version,
  copyright: `© ${currentYear}, Everlasting Ice Rx.`,
  meta: {
    title: "Command Center - Everlasting Ice Rx",
    description: "Product sourcing pipeline: factories, samples, quotes, contacts.",
  },
};
