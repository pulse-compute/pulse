'use strict';

const canonical = document.querySelector('link[rel="canonical"]');
if (canonical && canonical.href) window.location.replace(canonical.href);
