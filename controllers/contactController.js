// Contact page controller
exports.showContact = function (req, res) {
  res.render('contact', {
    user: req.session.user,
    success: req.flash('success'),
    error: req.flash('error')
  });
};
