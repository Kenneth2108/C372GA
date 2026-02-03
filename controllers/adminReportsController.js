const salesReportModel = require('../models/salesReportModel');

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(values) {
  return values.map(csvEscape).join(',');
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
          dayLabel = toLocalDateKey(row.day);
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
  ,
  async exportSalesReportCsv(req, res) {
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
          dayLabel = toLocalDateKey(row.day);
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

      const lines = [];
      lines.push(csvRow(['Sales Report']));
      lines.push(csvRow(['Start Date', startStr]));
      lines.push(csvRow(['End Date', endStr]));
      lines.push('');

      lines.push(csvRow(['Summary']));
      lines.push(csvRow(['Total Revenue', summary.grossRevenue.toFixed(2)]));
      lines.push(csvRow(['Net Revenue', netRevenue.toFixed(2)]));
      lines.push(csvRow(['Orders', summary.orderCount]));
      lines.push(csvRow(['Avg Order Value', summary.avgOrderValue.toFixed(2)]));
      lines.push(csvRow(['Refunds', summary.refundsTotal.toFixed(2)]));
      lines.push('');

      lines.push(csvRow(['Daily Revenue']));
      lines.push(csvRow(['Date', 'Orders', 'Revenue']));
      dailyStats.forEach((row) => {
        lines.push(csvRow([row.day, row.orderCount, row.revenue.toFixed(2)]));
      });
      lines.push('');

      lines.push(csvRow(['Payment Method Breakdown']));
      lines.push(csvRow(['Payment Method', 'Orders', 'Revenue']));
      paymentBreakdown.forEach((row) => {
        lines.push(csvRow([row.payment, row.orderCount, row.revenue.toFixed(2)]));
      });
      lines.push('');

      lines.push(csvRow(['Top Products']));
      lines.push(csvRow(['Product', 'Qty', 'Revenue']));
      topProductsList.forEach((row) => {
        lines.push(csvRow([row.productName, row.totalQty, row.revenue.toFixed(2)]));
      });

      const csv = lines.join('\r\n');
      const filename = `sales_report_${startStr}_to_${endStr}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (err) {
      console.error('Sales report CSV export error:', err);
      req.flash('error', 'Unable to export sales report.');
      return res.redirect('/admin/reports/sales');
    }
  }
};
