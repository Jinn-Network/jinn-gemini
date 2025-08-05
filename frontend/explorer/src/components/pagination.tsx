import { Button } from '@/components/ui/button'

interface PaginationProps {
  currentPage: number
  totalRecords: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalRecords, pageSize, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(totalRecords / pageSize)
  const hasNext = currentPage < totalPages
  const hasPrev = currentPage > 1

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <div className="text-sm text-gray-700">
        Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
      </div>
      
      <div className="flex items-center space-x-2">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrev}
        >
          Previous
        </Button>
        
        <div className="flex items-center space-x-1">
          {/* Show page numbers around current page */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number
            if (totalPages <= 5) {
              pageNum = i + 1
            } else if (currentPage <= 3) {
              pageNum = i + 1
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i
            } else {
              pageNum = currentPage - 2 + i
            }
            
            return (
              <Button
                key={pageNum}
                variant={pageNum === currentPage ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(pageNum)}
                className="min-w-[32px]"
              >
                {pageNum}
              </Button>
            )
          })}
        </div>
        
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNext}
        >
          Next
        </Button>
      </div>
    </div>
  )
}