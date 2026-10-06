// Runs in <head>: swap no-js for js before first paint so reveal states never flash.
document.documentElement.className = document.documentElement.className.replace('no-js', 'js');
