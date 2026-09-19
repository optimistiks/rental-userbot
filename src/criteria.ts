import { readConfiguredTextFile } from './text-file.js'

export function readCriteriaFile(criteriaPath: string): string {
  return readConfiguredTextFile(criteriaPath, 'Criteria')
}
