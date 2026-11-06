// A link in a Cigar Locker email: hands the tap to the email function, which
// counts it and sends the visitor on to the shop (097). Nothing is kept here.
(function () {
  var t = new URLSearchParams(location.search).get('t') || '';
  var to = 'https://nypahhdmoxrfvwnfufdf.supabase.co/functions/v1/email/r?t=' + encodeURIComponent(t);
  location.replace(to);
  document.addEventListener('DOMContentLoaded', function () {
    var go = document.getElementById('go');
    if (go) go.href = to;
  });
})();
