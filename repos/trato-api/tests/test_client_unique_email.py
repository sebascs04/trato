"""A freelancer keeps one client per contact email: a client already groups many projects."""
import unittest

from trato_api.errors import ApiError
from trato_api.persistence import Repository


class Repo(Repository):
    def __init__(self, existing):
        self.existing, self.reads, self.created = existing, [], []

    def rows(self, table, params):
        self.reads.append((table, params))
        return [{'id': 'client-1'}] if self.existing else []

    def call(self, method, path, **kwargs):
        self.created.append(kwargs['json'])
        return [{'id': 'client-2', **kwargs['json']}]


class UniqueClientEmailTests(unittest.TestCase):
    def test_the_same_email_is_refused(self):
        repo = Repo(existing=True)
        with self.assertRaises(ApiError) as caught:
            repo.create_client('Café Aurora', ' Owner@Cafe.example ')
        self.assertEqual((caught.exception.code, caught.exception.status), ('CLIENT_EMAIL_EXISTS', 409))
        self.assertEqual(repo.created, [])
        params = repo.reads[0][1]
        self.assertEqual((params['contact_email'], params['deleted_at']), ('ilike.Owner@Cafe.example', 'is.null'))

    def test_wildcards_in_the_address_are_matched_literally(self):
        repo = Repo(existing=False)
        repo.create_client('Lumen', 'first_last%x@yoga.example')
        self.assertEqual(repo.reads[0][1]['contact_email'], 'ilike.first\\_last\\%x@yoga.example')
        self.assertEqual(len(repo.created), 1)

    def test_a_client_without_email_is_created_without_checking(self):
        repo = Repo(existing=True)
        self.assertEqual(repo.create_client('Walk-in', None)['id'], 'client-2')
        self.assertEqual(repo.reads, [])


if __name__ == '__main__':
    unittest.main()
