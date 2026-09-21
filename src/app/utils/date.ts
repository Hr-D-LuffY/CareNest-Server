const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length

// A @db.Date column comes back as a UTC-midnight Date; clients want the plain calendar day.
export const toIsoDate = (date: Date) => date.toISOString().slice(0, ISO_DATE_LENGTH)
