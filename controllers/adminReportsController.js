const salesReportModel = require('../models/salesReportModel');

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateRange(query) {
  const today = new Date();
  const defaultEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultStart.getDate() - 29);
  defaultStart.setHours(0, 0, 0, 0);

  let start = defaultStart;
  let end = defaultEnd;

  if (query.start) {
    const parsedStart = new Date(`${query.start}T00:00:00`);
    if (!Number.isNaN(parsedStart.getTime())) {
      start = parsedStart;
    }
  }

  if (query.end) {
    const parsedEnd = new Date(`${query.end}T23:59:59`);
    if (!Number.isNaN(parsedEnd.getTime())) {
      end = parsedEnd;
    }
  }

  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return {
    start,
    end,
    startStr: toDateString(start),
    endStr: toDateString(end)
  };
}

function wrapQuery(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

module.exports = {
  async salesReport(req, res) {
    const { start, end, startStr, endStr } = parseDateRange(req.query || {});

    try {
      const [
        ordersSummary,
        refundsSummary,
        dailyRows,
        paymentRows,
        topProducts
      ] = await Promise.all([
        wrapQuery(salesReportModel.getOrdersSummary, start, end),
        wrapQuery(salesReportModel.getRefundsSummary, start, end),
        wrapQuery(salesReportModel.getDailyRevenue, start, end),
        wrapQuery(salesReportModel.getPaymentBreakdown, start, end),
        wrapQuery(salesReportModel.getTopProducts, start, end, 3)
      ]);

      const summary = {
        orderCount: Number(ordersSummary.orderCount || 0),
        grossRevenue: Number(ordersSummary.grossRevenue || 0),
        avgOrderValue: Number(ordersSummary.avgOrderValue || 0),
        refundsTotal: Number(refundsSummary.refundsTotal || 0)
      };

      const netRevenue = summary.grossRevenue - summary.refundsTotal;

      const dailyStats = (dailyRows || []).map((row) => {
        let dayLabel = row.day;
        if (row.day instanceof Date) {
          dayLabel = row.day.toISOString().slice(0, 10);
        } else if (typeof row.day === 'string') {
          dayLabel = row.day.slice(0, 10);
        }
        return {
          day: dayLabel,
          orderCount: Number(row.orderCount || 0),
          revenue: Number(row.revenue || 0)
        };
      });

      const paymentBreakdown = (paymentRows || []).map((row) => ({
        payment: row.payment || 'UNKNOWN',
        orderCount: Number(row.orderCount || 0),
        revenue: Number(row.revenue || 0)
      }));

      const topProductsList = (topProducts || []).map((row) => ({
        productId: row.productId,
        productName: row.productName || 'Unknown',
        totalQty: Number(row.totalQty || 0),
        revenue: Number(row.revenue || 0)
      }));

      return res.render('admin_sales_report', {
        user: req.session.user,
        range: { startStr, endStr },
        summary,
        netRevenue,
        dailyStats,
        paymentBreakdown,
        topProducts: topProductsList
      });
    } catch (err) {
      console.error('Sales report error:', err);
      req.flash('error', 'Unable to load sales report.');
      return res.redirect('/admin');
    }
  }
};
