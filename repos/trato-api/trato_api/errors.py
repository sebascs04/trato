class ApiError(Exception):
    def __init__(self, code, status):
        self.code, self.status = code, status
