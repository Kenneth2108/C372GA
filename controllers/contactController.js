// Contact page controller
exports.showContact = function (req, res) {
  res.render('contact_us', {
    user: req.session.user,
    success: req.flash('success'),
    error: req.flash('error')
  });
};
