import { Injectable } from "@nestjs/common";

import {
  generateReportService,
  getAllReportsService,
  resendReportService,
  updateReportSettingService,
} from "../../services/report.service";

/** Injectable seam over the existing `services/report.service` functions. */
@Injectable()
export class ReportService {
  getAll(
    userId: Parameters<typeof getAllReportsService>[0],
    pagination: Parameters<typeof getAllReportsService>[1],
  ) {
    return getAllReportsService(userId, pagination);
  }

  updateSetting(
    userId: Parameters<typeof updateReportSettingService>[0],
    body: Parameters<typeof updateReportSettingService>[1],
  ) {
    return updateReportSettingService(userId, body);
  }

  generate(
    userId: Parameters<typeof generateReportService>[0],
    from: Parameters<typeof generateReportService>[1],
    to: Parameters<typeof generateReportService>[2],
    baseCurrency: Parameters<typeof generateReportService>[3],
  ) {
    return generateReportService(userId, from, to, baseCurrency);
  }

  resend(
    userId: Parameters<typeof resendReportService>[0],
    reportId: Parameters<typeof resendReportService>[1],
  ) {
    return resendReportService(userId, reportId);
  }
}
